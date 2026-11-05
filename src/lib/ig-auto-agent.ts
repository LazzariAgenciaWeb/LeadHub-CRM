import { prisma } from "./prisma";
import { runAssistant, getServicesCatalogBlock, type ChatMessage } from "./assistant";
import {
  getAgentCalendarConnection, connectionCanWrite, computeAvailableSlots,
  isSlotStillFree, createMeetEvent, nowLabel, type Slot,
} from "./scheduling";
import {
  decryptAccountToken,
  getUserFollowStatus,
  sendMessageToUser,
  recordIgMessage,
  startDirectFollowGate,
} from "./instagram";

/**
 * Agente autônomo do Direct (Instagram) — irmão do auto-agent do WhatsApp.
 *
 * Fluxo: DM orgânica chega no webhook → scheduleIgAutoAgent() agenda com
 * debounce (mensagens picadas viram UMA resposta) → runIgAutoAgentNow() monta
 * o prompt (manual do agente + aprendizados + catálogo + histórico, incluindo
 * as DMs enviadas manualmente pela equipe via echo) e responde em bolhas curtas.
 *
 * Multi-tenant por construção: o agente vem de Assistant.igAccountId (vínculo
 * por conta de Instagram, igual ao instanceId do WhatsApp). Todo comportamento
 * comercial vive no manual editável da empresa — aqui só existe o esqueleto.
 *
 * O bot NUNCA responde quando: aiMode != ACTIVE (humano assumiu ou desligado),
 * há automação de palavra-chave em andamento pro contato (IgAutomationRun
 * aberto), a última mensagem do contato passou da janela de 24h da Meta, ou a
 * conta não tem agente ativo com autoRespond vinculado.
 */

export const IG_AUTO_AGENT_REV = "v13-agenda-no-direct";

/**
 * Resposta automática do RÔBO de atendimento do contato (menus de opções,
 * "vamos te transferir", aviso de fora do horário). Não é a pessoa falando.
 */
const AUTO_REPLY_RE =
  /(apert(e|ar|a)|cli(que|car|ca)|to(que|car|ca)|selecion(e|ar)|escolh(a|er)|digit(e|ar))\s+(em\s+)?(uma\s+das|um\s+dos|a|o|um|uma)?\s*(op[çc]|n[úu]mero|bot[ãa]o)|transferi(r|mos|remos)?\s+(voc[êe]\s+|lhe\s+)?(para|pra)\s+(um|o|uma|a)\s+(humano|atendente)|falar com (o|um|nosso) atendente|mensagem autom[áa]tica|resposta autom[áa]tica|assistente virtual|fora do (nosso )?hor[áa]rio de atendimento|bem-vindo\(a\)|estaremos (aqui|[àa] disposi[çc][ãa]o)/i;

/**
 * Objeção clássica de quem recebe prospecção: "já temos quem cuida", "já tenho
 * agência", "no momento não". NÃO é fim de conversa nem "não é lead" — é onde a
 * conversa começa de verdade. O agente já tratou isso como fora de escopo e
 * passou pro humano na primeira resposta, matando o contato.
 */
const OBJECTION_RE =
  /\b(j[áa]\s+(tem|temos|tenho|t[êe]m|trabalho|trabalhamos|fa[çc]o|fazemos|cuido|cuidamos|possu[oi]|resolvi|resolvemos)|(tenho|temos)\s+(ag[êe]ncia|quem|algu[ée]m|equipe|um time|pessoa|profissional|social media)|(n[ãa]o|nao)\s+(tenho|temos|estamos com)\s+interesse|(no momento|agora|hoje)\s+(n[ãa]o|nao)|fica\s+pra\s+depois|(obrigad[ao]|valeu)[,.!\s]*(mas|j[áa]))\b/i;

/**
 * Sinais REAIS de "não é lead" (vaga, parceria, quem vende pra gente). Só
 * estes justificam encerrar e passar pro humano na primeira resposta.
 */
const NOT_LEAD_RE =
  /\b(vaga|vagas|emprego|contratar\s+(voc[êe]|o diego)|curr[íi]culo|clt|sal[áa]rio|freela(ncer)?|parceria|permuta|podcast|entrevista|patroc[íi]nio|divulga[çc][ãa]o|revenda|representante|afiliado)\b/i;

/** Texto vazio ou só pontuação ("—", ".") — o card sem texto que a inbox mostra como "—". */
function isPlaceholderText(t: string): boolean {
  return !t || /^[\s\-–—.·•]*$/.test(t);
}

const DEBOUNCE_MS = 12_000;
const HISTORY_LIMIT = 30;
const MAX_REPLY_TOKENS = 500;
const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const BUBBLE_DELAY_MS = 1_800;

// ─── Diagnóstico em memória (mesmo padrão do auto-agent do WhatsApp) ─────────
const recentRuns: Record<string, unknown>[] = (globalThis as any).__igAutoAgentRuns ?? [];
(globalThis as any).__igAutoAgentRuns = recentRuns;
export function getRecentIgAutoAgentRuns() {
  return recentRuns;
}
/**
 * Grava na conversa o resultado da última tentativa — a Inbox do Instagram
 * mostra isso. Fire-and-forget: diagnóstico nunca segura o atendimento.
 */
function persistIgResult(conversationId: string, result: string) {
  prisma.igConversation
    .update({ where: { id: conversationId }, data: { aiLastResult: result, aiLastRunAt: new Date() } as any })
    .catch(() => {});
}

function recordRun(entry: Record<string, unknown>) {
  recentRuns.unshift({ ts: new Date().toISOString(), ...entry });
  if (recentRuns.length > 12) recentRuns.pop();
}

// ─── Debounce ────────────────────────────────────────────────────────────────
const pending: Map<string, ReturnType<typeof setTimeout>> =
  (globalThis as any).__igAutoAgentTimers ?? new Map();
(globalThis as any).__igAutoAgentTimers = pending;

/** Agenda o processamento da conversa (debounce). Chamar a cada DM orgânica. */
export function scheduleIgAutoAgent(conversationId: string): void {
  const prev = pending.get(conversationId);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    pending.delete(conversationId);
    runIgAutoAgentNow(conversationId).catch((e) =>
      console.error(`[IgAgent] run falhou conv=${conversationId}:`, e?.message),
    );
  }, DEBOUNCE_MS);
  pending.set(conversationId, t);
}

/**
 * Cancela um processamento agendado. Usado quando um humano responde primeiro
 * (echo OUT chega antes do debounce vencer) — o time chegou antes do bot.
 */
export function cancelIgAutoAgent(conversationId: string): void {
  const prev = pending.get(conversationId);
  if (prev) {
    clearTimeout(prev);
    pending.delete(conversationId);
  }
}

// ─── Prospecção: casar contato do Direct com Lead pelo @ ─────────────────────

function normalizeIgUsername(u: string | null | undefined): string | null {
  const s = (u ?? "").trim().replace(/^@/, "").toLowerCase();
  return s || null;
}

/** Lead da empresa cujo campo instagram casa com o @ do contato (best-effort). */
export async function findLeadByIgUsername(companyId: string, username: string | null | undefined) {
  const ig = normalizeIgUsername(username);
  if (!ig) return null;
  return prisma.lead.findFirst({
    where: { companyId, instagram: { equals: ig, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Prospect respondeu no Direct → vincula a conversa ao Lead (leadId) e, se
 * ainda está em PROSPECCAO, promove pra LEADS (primeira etapa) com atribuição.
 * Determinístico: roda no webhook, independente do agente responder ou não.
 * Mesmo padrão do clique no diagnóstico (/d/[token]).
 */
export async function promoteIgProspectOnReply(
  companyId: string,
  username: string | null | undefined,
  conversationId?: string | null,
): Promise<void> {
  const lead = await findLeadByIgUsername(companyId, username);
  if (!lead) return;

  // Vínculo conversa ↔ lead (backfill; idempotente).
  if (conversationId) {
    await prisma.igConversation
      .updateMany({ where: { id: conversationId, leadId: null }, data: { leadId: lead.id } })
      .catch(() => {});
  }

  if (lead.pipeline !== "PROSPECCAO") return;
  const firstStage = await prisma.pipelineStageConfig.findFirst({
    where: { companyId, pipeline: "LEADS" },
    orderBy: { order: "asc" },
    select: { name: true },
  });
  const stamp = `Respondeu no Direct em ${new Date().toLocaleDateString("pt-BR")}.`;
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      pipeline: "LEADS",
      pipelineStage: firstStage?.name ?? null,
      notes: lead.notes ? `${lead.notes}\n\n${stamp}` : stamp,
      promotedFromPipeline: "PROSPECCAO",
      promotedAt: new Date(),
      promotedReason: "direct_reply",
    },
  });
  console.log(`[IgAgent] prospect @${normalizeIgUsername(username)} promovido pra LEADS (lead ${lead.id})`);
}

// ─── Parser tolerante do JSON da IA ──────────────────────────────────────────
type AgentDecision = {
  reply: string[];
  action: "NONE" | "HANDOFF" | "AGENDAR";
  /** Código do horário escolhido ("S1") — só na action AGENDAR. */
  agendarInicio?: string | null;
  agendarEmail?: string | null;
};

/** Agenda conectada do agente + horários livres desta rodada. */
interface IgScheduling {
  connectionId: string;
  durationMin: number;
  slots: Slot[];
}

/**
 * O histórico marca as mensagens do time com "[equipe] " pra dar contexto ao
 * modelo — e o modelo imitava o padrão, mandando "[equipe] Beleza!" direto pro
 * cliente. Aqui a etiqueta é arrancada antes de qualquer envio (o prompt também
 * proíbe, mas isto é a garantia mecânica).
 */
function stripInternalTags(text: string): string {
  return text
    .replace(/^\s*[[(](?:equipe|time|atendente|agente|ia|bot)[\])]\s*:?\s*/i, "")
    .trim();
}

/** @ do Instagram dentro de link ou menção ("instagram.com/fulano", "@fulano"). */
function extractIgHandles(text: string): string[] {
  const handles = new Set<string>();
  const fromUrl = text.matchAll(/instagram\.com\/([A-Za-z0-9._]{2,30})/gi);
  for (const m of fromUrl) {
    const h = m[1].toLowerCase();
    if (!["p", "reel", "reels", "stories", "explore", "direct"].includes(h)) handles.add(h);
  }
  for (const m of text.matchAll(/(?:^|\s)@([A-Za-z0-9._]{2,30})/g)) handles.add(m[1].toLowerCase());
  return [...handles];
}

/** O contato aceitou a oferta que a equipe fez ("pode", "manda", "à vontade"…). */
function looksLikeAcceptance(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (t.length > 140) return false;
  // "pode chamar no whatsapp / liga pra mim / ta na bio" não é aceite do
  // diagnóstico — é redirecionamento de canal, tratado pelo manual.
  if (/\b(whats|whatsapp|zap|bio|liga|ligar|telefone|e-?mail|chama no)\b/.test(t)) return false;
  return /\b(pode|podes|pode sim|claro|manda|manda ai|pode mandar|quero|bora|vamos|sim|isso|aceito|topo|mostra|me mostra|adoraria|por favor|fico no aguardo|a vontade|fique a vontade|fica a vontade)\b/.test(t);
}

function parseDecision(raw: string): AgentDecision | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    const reply = Array.isArray(obj.reply)
      ? obj.reply.map((b: unknown) => stripInternalTags(String(b ?? ""))).filter(Boolean)
      : typeof obj.reply === "string" && obj.reply.trim()
        ? [stripInternalTags(obj.reply)].filter(Boolean)
        : [];
    const action =
      obj.action === "HANDOFF" ? "HANDOFF" : obj.action === "AGENDAR" ? "AGENDAR" : "NONE";
    return {
      reply: reply.slice(0, 3),
      action,
      agendarInicio: typeof obj.agendarInicio === "string" ? obj.agendarInicio.trim() : null,
      agendarEmail: typeof obj.agendarEmail === "string" ? obj.agendarEmail.trim() : null,
    };
  } catch {
    return null;
  }
}


// ─── Agendamento: casar o horário escolhido ──────────────────────────────────

const normTxt = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const WEEKDAY_WORDS: Record<string, string[]> = {
  dom: ["dom", "domingo"], seg: ["seg", "segunda"], ter: ["ter", "terca"],
  qua: ["qua", "quarta"], qui: ["qui", "quinta"], sex: ["sex", "sexta"], sab: ["sab", "sabado"],
};

/** Pedaços do label "ter 05/11 09:00" pra reconhecer no texto do contato. */
function slotTokens(slot: Slot): { days: string[]; times: string[] } {
  const m = slot.label.match(/^(\w{3})\s+(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return { days: [], times: [] };
  const [, wd, dd, mm, hh, mi] = m;
  const day = Number(dd), month = Number(mm), hour = Number(hh);
  return {
    days: [`${dd}/${mm}`, `${day}/${month}`, `dia ${day}`, ...(WEEKDAY_WORDS[normTxt(wd)] ?? [])],
    times: [`${hh}:${mi}`, `${hour}:${mi}`, `${hour}h${mi === "00" ? "" : mi}`, `${hour}h`, ...(mi === "00" ? [`${hour} horas`, `${hour}`] : [])],
  };
}

/** Token isolado (não casar "9" dentro de "19"). */
function hasToken(text: string, token: string): boolean {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9a-z])${esc}([^0-9a-z]|$)`, "i").test(text);
}

function mentionsSlot(text: string, slot: Slot): { time: boolean; day: boolean } {
  const t = normTxt(text);
  const { days, times } = slotTokens(slot);
  return { time: times.some((x) => hasToken(t, x)), day: days.some((x) => hasToken(t, x)) };
}

/** Horários que NÓS oferecemos na última mensagem (é entre eles que ele escolhe). */
export function slotsWeOffered(lastOutText: string | null | undefined, slots: Slot[]): Slot[] {
  if (!lastOutText) return [];
  return slots.filter((sl) => {
    const hit = mentionsSlot(lastOutText, sl);
    return hit.time && hit.day;
  });
}

/**
 * Horário escolhido: código do JSON ("S1") primeiro; depois o texto do contato
 * (dia + hora); por último só a hora, quando ela identifica sem ambiguidade um
 * dos horários que oferecemos.
 */
export function resolveIgSlot(slots: Slot[], code: string | null | undefined, contactText: string, offered: Slot[]): Slot | null {
  const byCode = (code ?? "").trim().match(/^\[?s(\d{1,2})\]?$/i);
  if (byCode) {
    const idx = Number(byCode[1]) - 1;
    if (slots[idx]) return slots[idx];
  }
  const exact = slots.find((sl) => {
    const hit = mentionsSlot(contactText, sl);
    return hit.time && hit.day;
  });
  if (exact) return exact;
  const byTime = offered.filter((sl) => mentionsSlot(contactText, sl).time);
  if (byTime.length === 1) return byTime[0];
  // Ofereceu 1 horário só e ele apenas concordou ("pode ser", "fechado").
  if (offered.length === 1 && looksLikeAcceptance(contactText)) return offered[0];
  return null;
}

/** "ter 05/11 09:00" → "ter 05/11 às 09:00" (slot livre ou reunião já criada). */
const prettySlot = (sl: { label: string }) => sl.label.replace(/ (\d{1,2}:\d{2})$/, " às $1");

/** 1 de manhã + 1 de tarde, como manda a regra do agendamento. */
function pickTwo(slots: Slot[]): Slot[] {
  const manha = slots.find((sl) => sl.period === "manha");
  const tarde = slots.find((sl) => sl.period === "tarde");
  return manha && tarde ? [manha, tarde] : slots.slice(0, 2);
}

const PLACEHOLDER_EMAIL_RE =
  /@(example|exemplo|email|e-mail|teste|test|dominio|domain|seudominio|suaempresa|empresa)\.(com|com\.br|br|org|net)$/i;

/**
 * Bloco de agenda do Direct: horários livres com código curto (S1, S2…) — o
 * modelo devolve o código, muito mais confiável que copiar data/hora sem errar.
 */
function igSchedulingBlock(ctx: IgScheduling): string {
  const indexed = ctx.slots.map((sl, i) => ({ sl, code: `S${i + 1}` }));
  const fmt = (list: { sl: Slot; code: string }[]) =>
    list.length ? list.map((x) => `[${x.code}] ${x.sl.label}`).join(" | ") : "(nenhum)";

  return `\n# AGENDAMENTO DIRETO (você marca a conversa aqui mesmo — NUNCA mande link de agenda)
⚠️ Esta seção vale mais que qualquer instrução do manual sobre agendamento ("mande o link", "o time vê a agenda"). A agenda está na SUA mão: os horários livres estão abaixo.
Agora: ${nowLabel()} (horário de Brasília). Conversa de ${ctx.durationMin} minutos no Google Meet.
Horários LIVRES:
MANHÃ: ${fmt(indexed.filter((x) => x.sl.period === "manha").slice(0, 6))}
TARDE: ${fmt(indexed.filter((x) => x.sl.period === "tarde").slice(0, 6))}

Regras do agendamento:
- Ofereça no MÁXIMO 2 opções por vez: 1 de manhã e 1 de tarde. Se um período não tiver horário, ofereça 2 do outro.
- Ofereça SOMENTE horários das listas. NUNCA invente nem confirme horário fora delas, e NUNCA mande link de agenda (nem o que estiver no manual).
- NUNCA ofereça horário pra HOJE — as listas já começam no próximo dia útil.
- Se nenhum servir, pergunte a preferência dele (dia ou período) e ofereça outras 2 opções das listas.
- Peça o e-mail UMA vez ("pra te mandar o convite"). Se ele não quiser passar, confirme assim mesmo — o link do Meet vai por aqui no Direct.
- Quando o contato ESCOLHER um horário, use action "AGENDAR" com "agendarInicio" = o CÓDIGO do horário (ex.: "S1"), "agendarEmail" = o e-mail (ou null) e "reply" vazio ([]): o sistema confirma e manda o link do Meet sozinho.
- Listas vazias (sem horário livre): avise que o time retorna pra combinar o melhor horário e use action "HANDOFF". NUNCA confirme conversa sem horário livre.`;
}

// ─── Motor ───────────────────────────────────────────────────────────────────
export async function runIgAutoAgentNow(conversationId: string): Promise<void> {
  const conv = await prisma.igConversation.findUnique({
    where: { id: conversationId },
    include: { account: true },
  });
  const skip = (reason: string, extra?: Record<string, unknown>) => {
    recordRun({ conv: conversationId, skip: reason, ...extra });
    console.log(`[IgAgent] skip conv=${conversationId}: ${reason}`);
    if (conv) persistIgResult(conversationId, reason);
  };

  if (!conv) return skip("conversa_inexistente");
  if (conv.channel !== "INSTAGRAM" || !conv.account) return skip("canal_nao_suportado");
  // RETOMADA: o handoff foi do PRÓPRIO agente ("já passei pro time"), ninguém
  // do time entrou e o contato continuou falando. Deixar parado aí é abandono —
  // o agente volta UMA vez por conversa (aiResumedAt) e segue a conversa.
  let resumedAfterHandoff = false;
  if (conv.aiMode === "PAUSED_HUMAN" && (conv as any).aiPausedBy === "AI" && !(conv as any).aiResumedAt) {
    const humanReplied = await prisma.igMessage.findFirst({
      where: {
        conversationId: conv.id,
        direction: "OUT",
        source: { in: ["EXTERNAL", "AGENT"] },
        createdAt: { gt: conv.aiLastRunAt ?? conv.createdAt },
      },
      select: { id: true },
    });
    if (humanReplied) return skip("aiMode_PAUSED_HUMAN");
    await prisma.igConversation.update({
      where: { id: conv.id },
      data: { aiMode: "ACTIVE", aiResumedAt: new Date() } as any,
    });
    conv.aiMode = "ACTIVE";
    resumedAfterHandoff = true;
    console.log(`[IgAgent] retomando conv=${conv.id} — handoff do agente sem ninguém do time entrar`);
  } else if (conv.aiMode !== "ACTIVE") {
    return skip(`aiMode_${conv.aiMode}`);
  }
  // Só responde quando a ÚLTIMA mensagem é do contato (se OUT depois do
  // agendamento, alguém — humano ou automação — já respondeu).
  if (conv.lastDirection !== "IN") return skip("ja_respondida");

  // Agente da conta (vínculo igAccountId; precisa estar ativo E em modo autônomo).
  const assistant = await prisma.assistant.findFirst({
    where: { companyId: conv.companyId, igAccountId: conv.accountId, isActive: true, autoRespond: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!assistant) return skip("sem_agente_vinculado");

  // Precedência: automação de palavra-chave em andamento é dona da conversa.
  const openRun = await prisma.igAutomationRun.findFirst({
    where: {
      accountId: conv.accountId!,
      igCommenterId: conv.participantId,
      status: { in: ["PENDING", "COMMENT_REPLIED", "DM_SENT", "AWAITING_FOLLOW"] },
    },
    select: { id: true },
  });
  if (openRun) return skip("automacao_em_andamento", { run: openRun.id });

  // Trava opcional: conversa que NASCEU de automação (isca, follow, link) não
  // é assumida pelo agente nem depois que a automação termina. Quem baixou
  // material não virou lead por isso — o time decide se puxa conversa.
  if ((assistant as any).skipAutomationConvos && conv.hadAutomation) {
    return skip("conversa_de_automacao");
  }

  const token = decryptAccountToken(conv.account.accessTokenEnc);
  if (!token) return skip("conta_sem_token");

  // Histórico (asc) + janela de 24h da Meta sobre a última mensagem do contato.
  const history = await prisma.igMessage.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { direction: true, source: true, text: true, createdAt: true },
  });
  history.reverse();
  const lastIn = [...history].reverse().find((m) => m.direction === "IN");
  if (!lastIn) return skip("sem_mensagem_do_contato");
  if (Date.now() - lastIn.createdAt.getTime() > WINDOW_24H_MS) return skip("fora_janela_24h");

  // O que o contato mandou desde a nossa última fala.
  const lastOutIdx = history.map((m) => m.direction).lastIndexOf("OUT");
  const pendingIn = history.slice(lastOutIdx + 1).filter((m) => m.direction === "IN");
  const pendingTexts = pendingIn.map((m) => (m.text ?? "").trim()).filter((t) => !isPlaceholderText(t));
  // Só mensagem SEM TEXTO (card de menu/botão, figurinha, mídia): o histórico
  // descarta essas, então o modelo recebia uma conversa terminando na NOSSA
  // fala e escrevia a próxima — a do contato ("Oi! Sim, sou eu que cuido do
  // Patrolão"). Sem texto novo, não há o que responder: o time vê na inbox.
  if (!pendingTexts.length) return skip("sem_texto_do_contato");
  // Quem respondeu foi o ROBÔ de atendimento do contato ("aperte uma das
  // opções", "vamos te transferir para um humano"). Conversar com ele gera
  // loop e falas sem sentido; esperar a pessoa de verdade aparecer.
  if (pendingTexts.every((t) => AUTO_REPLY_RE.test(t))) return skip("contato_e_robo");

  // Follow status (best-effort) — o manual da empresa decide o que fazer com isso.
  const follows = await getUserFollowStatus(conv.participantId, token);

  // FOLLOW-GATE: quando o contato aceita ver o diagnóstico mas ainda não segue,
  // quem pede o follow é a MESMA máquina das automações de post (checagem real
  // + botão "já te segui" + run AWAITING_FOLLOW) — não o texto improvisado do
  // modelo. Assim que o follow é confirmado, o agente é chamado de volta e
  // entrega. Sem gate: pedido some no meio da conversa e ninguém confere nada.
  if (follows === false && looksLikeAcceptance(lastIn.text ?? "")) {
    const gate = await startDirectFollowGate(
      conv.account,
      conv.participantId,
      conv.participantUsername ?? null,
      token,
    );
    if (gate === "ASKED") {
      recordRun({ conv: conv.id, gate: "follow_pedido_via_automacao" });
      persistIgResult(conv.id, "follow_pedido");
      console.log(`[IgAgent] follow-gate acionado conv=${conv.id} — agente aguarda o follow`);
      return;
    }
  }
  const followLine =
    follows === true ? "O contato JÁ SEGUE o perfil da empresa."
    : follows === false ? "O contato AINDA NÃO SEGUE o perfil da empresa."
    : "Não foi possível verificar se o contato segue o perfil.";

  // Dados do prospect levantados pela equipe (rotina de prospecção → webhook
  // de leads com o @). Usa o vínculo direto quando existe; senão casa pelo @
  // e faz o backfill do leadId.
  const lead = conv.leadId
    ? await prisma.lead.findUnique({ where: { id: conv.leadId } })
    : await findLeadByIgUsername(conv.companyId, conv.participantUsername);
  if (lead && !conv.leadId) {
    await prisma.igConversation
      .updateMany({ where: { id: conv.id, leadId: null }, data: { leadId: lead.id } })
      .catch(() => {});
  }
  const prospectBlock = lead
    ? `\n\n# ACHADOS DA EQUIPE SOBRE ESTE PROSPECT — é ESTE o material do "diagnóstico" que a abordagem prometeu.\n` +
      `Use como CONTEÚDO da conversa, com as suas palavras: o que é POSITIVO vira o elogio de abertura; o que dá pra melhorar vira o ponto que você entrega de graça (UM só) e os demais são o motivo da conversa de 15 minutos. NÃO copie a ficha inteira, não leia como lista, não despeje tudo de uma vez e nunca diga que existe uma ficha.\n` +
      [
        lead.name ? `- Nome/negócio: ${lead.name}` : null,
        lead.segment ? `- Segmento: ${lead.segment}` : null,
        lead.city ? `- Cidade: ${lead.city}` : null,
        lead.notes ? `- Avaliação da equipe:\n${lead.notes.slice(0, 1500)}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const catalog = await getServicesCatalogBlock(conv.companyId);
  const checklist = assistant.qualificationChecklist?.trim()
    ? `\n\n# CHECKLIST DE QUALIFICAÇÃO (colete naturalmente, UMA informação por vez)\n${assistant.qualificationChecklist.trim()}`
    : "";
  const learnings = assistant.learnings?.trim()
    ? `\n\n# APRENDIZADOS (correções do gestor — respeite sempre)\n${assistant.learnings.trim()}`
    : "";
  // Agendamento direto no Direct: agenda Google do usuário vinculado ao agente
  // ∩ horários de atendimento da empresa. Qualquer falha → fallback pro link.
  let igScheduling: IgScheduling | null = null;
  const calendarUserId = (assistant as any).calendarUserId as string | null;
  if (calendarUserId) {
    try {
      const connCal = await getAgentCalendarConnection(calendarUserId);
      if (!connCal) {
        console.warn(`[IgAgent] agenda do agente sem conexão ativa (user=${calendarUserId}) — usando link`);
      } else if (!connectionCanWrite(connCal)) {
        console.warn(`[IgAgent] conexão de agenda sem escopo de escrita (user=${calendarUserId}) — usando link`);
      } else {
        const durationMin = ((assistant as any).meetingDurationMin as number) || 15;
        const slots = await computeAvailableSlots({ companyId: conv.companyId, connectionId: connCal.id, durationMin });
        igScheduling = { connectionId: connCal.id, durationMin, slots };
        // Rastro de sucesso: é o único jeito de confirmar nos logs que o Direct
        // está oferecendo horários (os casos de falha já avisam acima).
        console.log(`[IgAgent] agenda ativa no Direct (user=${calendarUserId}, ${durationMin}min, ${slots.length} horários livres)`);
      }
    } catch (err: any) {
      console.error(`[IgAgent] falha ao montar agenda conv=${conv.id} (fallback pro link):`, err?.message);
    }
  }
  const meetingMin = igScheduling?.durationMin ?? 15;
  const scheduling = igScheduling
    ? igSchedulingBlock(igScheduling)
    : assistant.schedulingLink?.trim()
      ? `\n\nLink de agendamento (copie EXATAMENTE quando for convidar para reunião): ${assistant.schedulingLink.trim()}`
      : "";

  // Continuidade: a abordagem (enviada pela equipe) costuma terminar com uma
  // oferta — "posso te mostrar o que vi?". Quando o contato aceita, o pecado é
  // responder com pergunta genérica de dor em vez de ENTREGAR o prometido.
  const lastTeamMsg = [...history].reverse().find((m) => m.direction === "OUT");
  const contactAccepted = looksLikeAcceptance(lastIn.text ?? "");
  const teamOffered = /\?|posso|quer que|te mostro|te mando|mostrar|vi (?:que|uma|algo)/i.test(lastTeamMsg?.text ?? "");
  const continuityBlock =
    contactAccepted && teamOffered
      ? `\n# ⚠️ O CONTATO ACABOU DE ACEITAR (prioridade máxima)\nA última mensagem nossa fez uma oferta/pergunta e o contato respondeu que SIM. Siga o FLUXO abaixo a partir do passo que faz sentido — e NÃO pergunte "qual sua maior dificuldade" nem qualquer pergunta genérica de qualificação agora: quem acabou de dizer "pode mostrar" quer ver, não responder questionário.`
      : "";

  // Anti-alucinação: o modelo não abre perfil nenhum. Ele já afirmou "sua bio
  // está sem chamada pra ação" para um perfil que TINHA — o contato percebe na
  // hora e a conversa morre. Só pode afirmar o que está nos achados da equipe.
  // Quantas vezes o agente já puxou agendamento nesta conversa. Passou de 2,
  // vira insistência — e insistência queima a reputação de quem prospecta.
  const inviteRe = /\b(agendar|agendamos|marcar|marcamos|15\s?min|quinze minutos|hor[áa]rio|conversa r[áa]pida|bate-?papo)\b/i;
  const invitesSent = history.filter(
    (m) => m.direction === "OUT" && m.source === "AI" && inviteRe.test(m.text ?? ""),
  ).length;
  const inviteGuard =
    invitesSent >= 2
      ? `\n# ⛔ PARE DE CONVIDAR (você já chamou pra conversa ${invitesSent} vezes)
Não convide de novo, não pergunte "vamos agendar?", não reformule o convite. A pessoa já entendeu e não engatou.
Responda o que ela perguntou, seja útil de graça e ENCERRE com simpatia — ou passe pro humano com action "HANDOFF". Insistir daqui pra frente só queima a imagem do Diego.`
      : "";

  // Objeção na mensagem nova (e nenhum sinal de que não é lead): é o momento
  // mais importante da prospecção — e era exatamente onde o agente desistia.
  const contactObjected =
    pendingTexts.some((t) => OBJECTION_RE.test(t)) && !pendingTexts.some((t) => NOT_LEAD_RE.test(t));
  const objectionBlock = contactObjected
    ? `\n# 💬 O CONTATO LEVANTOU UMA OBJEÇÃO (prioridade máxima — isto NÃO é handoff)
"Já temos quem cuida", "já tenho agência", "temos equipe interna", "no momento não" é a resposta mais comum de quem recebe prospecção. NÃO significa que a conversa acabou, NÃO significa que ele não é lead e NÃO é assunto de humano: é aqui que a conversa começa.
Como responder (1 a 2 bolhas curtas):
- Respeite quem já cuida: nunca critique, duvide ou insinue que o atual é ruim.
- ENTREGUE na hora um achado concreto dos ACHADOS DA EQUIPE — o ponto específico que motivou a abordagem, em linguagem simples. É isso que separa a gente de quem só manda proposta.
- Deixe claro que a gente NÃO vem pra tomar o lugar de quem já cuida: a gente COMPLEMENTA. O time dele toca o dia a dia e a gente entra nas frentes que faltam — site, campanhas patrocinadas (tráfego) e consultoria pra usar ferramentas de IA no dia a dia da empresa. Cite só as frentes que fazem sentido pro caso dele (olhe o CATÁLOGO DE SERVIÇOS), no máximo duas por mensagem, sem listar tudo como cardápio.
- Feche com UMA pergunta leve, de baixo compromisso (se alguma dessas frentes interessa, ou se o ponto que você mostrou já está no radar de quem cuida). Não emende o convite na mesma mensagem — se ele reagir bem, aí sim venha o convite dos 15 minutos com a transparência do passo 6.
- É PROIBIDO usar action "HANDOFF" agora e é PROIBIDO dizer que vai passar pro Diego: quem conversa é você.
- Se depois disso ele reforçar que não quer, aí sim agradeça, deixe a porta aberta em uma frase e encerre (action "NONE", sem convite).`
    : "";

  const resumeBlock = resumedAfterHandoff
    ? `\n# ↩️ VOCÊ JÁ TINHA PASSADO ESTA CONVERSA PRO TIME E O CONTATO CONTINUOU FALANDO
Ninguém do time entrou ainda e ele escreveu de novo — deixar no vácuo é o pior desfecho. Responda VOCÊ a mensagem nova: nada de recomeçar a conversa, nada de repetir que vai passar pra alguém, nada de se desculpar. Trate o que ele acabou de dizer e faça a conversa andar.`
    : "";

  const notLeadBlock = `\n# 🚩 QUANDO NÃO É LEAD (pare de vender na hora)
Estes casos NÃO são clientes em potencial. NÃO convide pra conversa, NÃO insista, NÃO tente qualificar. Responda UMA frase educada e use action "HANDOFF":
- Proposta de EMPREGO ou vaga (CLT, freelancer fixo, salário, "ofereço R$X + benefícios"), ou alguém querendo contratar o Diego como funcionário.
- Parceria, permuta, convite para evento/podcast, pedido de divulgação.
- Alguém vendendo algo PARA nós (serviço, curso, ferramenta).
- Assunto pessoal, cobrança ou qualquer coisa fora de prospecção.
NÃO entram aqui (são OBJEÇÃO, você mesmo responde): "já temos quem cuida", "já tenho agência", "temos equipe interna", "não tenho interesse", "no momento não". Passar essas pro humano é abandonar o contato no melhor momento da conversa.
Tom do encerramento (NÃO copie a frase — escreva com as suas palavras, no contexto): dizer que quem cuida disso é o Diego e que você já passou pra ele responder por ali.
Sinal claro de erro: se a pessoa está te oferecendo dinheiro/trabalho e você respondeu convidando pra agendar, você errou. Ela não é lead.`;

  const groundingBlock = `\n# 🚫 REGRA DE OURO — NUNCA INVENTE UM DIAGNÓSTICO
Você NÃO consegue abrir, ver, acessar ou analisar perfis do Instagram, sites, bio ou ficha do Google. Quem olhou foi a EQUIPE, e tudo que ela viu está em ACHADOS DA EQUIPE. Você fala pela empresa, então pode dizer "a gente deu uma olhada no seu perfil" — mas só pode afirmar o que está nos achados.
- A ÚNICA coisa que você sabe sobre o negócio do contato é o que está em ACHADOS DA EQUIPE${lead ? "" : " — e nesta conversa NÃO HÁ achados nenhum"}.
- É PROIBIDO afirmar qualquer característica do perfil que não esteja lá ("sua bio está sem link", "falta chamada pra ação", "seu feed está desorganizado"). Já aconteceu de dizer que faltava link na bio quando tinha — isso queima a confiança na hora.
- Se o contato pedir análise de um perfil que não está nos achados (por exemplo um segundo perfil dele), seja honesto e simpático: diga que vai olhar com calma e que retorna com os pontos — e use action "HANDOFF" pra equipe assumir. NUNCA chute pra parecer útil.

# 🚫 NUNCA INVENTE CONHECIMENTO OU EXPERIÊNCIA
Você também não sabe de que setores, mercados ou assuntos técnicos o Diego entende — só o que está no manual e no catálogo.
- É PROIBIDO dizer que ele entende do ramo do contato, que já atendeu casos parecidos, ou citar experiência/números/cases que não estejam escritos aqui. JÁ ACONTECEU de afirmar que ele entendia de plantio, tomate e irrigação — ele não entende nada disso, e a pessoa percebe na hora.
- O que o Diego domina é o DIGITAL do negócio (aparecer, atrair cliente, organizar a presença) — nunca a operação técnica do ramo dela.
- Perguntaram "você entende do meu setor?": responda com honestidade e vantagem — "de [setor] quem entende é você; o que a gente domina é fazer teu negócio aparecer e atrair cliente. Na conversa vocês juntam as duas coisas."`;

  const flowBlock = `\n# FLUXO DESTA CONVERSA (Direct de prospecção)
Este é o roteiro, nesta ordem. Uma ideia por mensagem — ele se desenrola em várias trocas, não num textão só.
1. FOLLOW — NÃO peça follow por conta própria: o sistema cuida disso sozinho (checa de verdade se a pessoa segue e manda o pedido oficial com botão). Se você está sendo chamado, esse passo já foi resolvido — vá pro passo 2.
2. ELOGIO — abra reconhecendo algo CONCRETO e verdadeiro do negócio dele, tirado dos ACHADOS DA EQUIPE (um conteúdo bom, o cuidado com o produto, a frequência de posts). Elogio genérico ("adorei seu perfil") soa falso e queima a abertura. Sem nada concreto nos achados, reconheça o trabalho sem inventar característica.
3. PONTOS DE MELHORIA — diga, com naturalidade, que nessa olhada rápida você viu ALGUNS pontos que dariam pra melhorar. Fale que são alguns; não liste todos.
4. ENTREGA DE UM PONTO (de graça, agora) — entregue UM ponto concreto dos ACHADOS, explicado simples, pra ele já poder melhorar hoje. É presente, não amostra grátis com cobrança depois. UM só: os outros são o motivo da conversa.
5. CONVITE — chame pra uma conversa de ${meetingMin} minutos, SEM CUSTO, pra mostrar os demais pontos${igScheduling ? " (ofereça 2 horários livres da seção AGENDAMENTO DIRETO — nunca um link)" : assistant.schedulingLink?.trim() ? " (mande o link de agendamento)" : ""}. Conecte com o ponto que você acabou de entregar.
6. TRANSPARÊNCIA COMERCIAL (obrigatória no convite ou logo depois) — deixe claro, sem rodeio e sem pedir desculpa: somos uma agência; nesses ${meetingMin} minutos você mostra os outros pontos e um pouco do que a gente faz e, se fizer sentido pros dois lados, depois disso a gente manda uma proposta. NUNCA venda a conversa como "sem compromisso nenhum" fingindo que não é comercial — a pessoa percebe e a confiança cai. O enquadramento certo: a gente só cresce quando o cliente cresce, por isso mostra o que viu antes de propor qualquer coisa.
${lead ? "" : "\n⚠️ ATENÇÃO: nesta conversa NÃO HÁ achados da equipe. Sem eles não dá pra elogiar algo concreto nem apontar ponto de melhoria sem inventar — e inventar queima a conversa na hora. Não chute: puxe pela conversa (pergunte o que hoje mais trava a presença digital dele) e, se ele pedir a análise, diga com honestidade que o time vai olhar com calma e retorna, com action \"HANDOFF\"."}
Nunca pule o passo 4: convidar sem ter entregado nada é o pior cenário — vira mais uma mensagem de agência pedindo reunião.
Nunca entregue tudo (passo 4 com 3, 4 pontos): aí não sobra motivo pra conversa.
Quando o contato aceitar ver o que encontramos ("quero ver", "pode mostrar", "manda"), isso É lead quente: entregue o ponto (passo 4) e siga pro convite com a transparência do passo 6. NUNCA responda "quem vê é o Diego" nem passe pro humano nesse momento.`;

  // @ enviado pelo contato (link ou menção) — o modelo pedia o @ que já tinha
  // sido informado, ou tratava o link como pedido de follow.
  const handlesFromContact = extractIgHandles(lastIn.text ?? "");
  const handleBlock = handlesFromContact.length
    ? `\n# PERFIL INFORMADO PELO CONTATO\nO contato enviou: ${handlesFromContact.map((h) => "@" + h).join(", ")}. É sobre esse perfil que ele quer falar — NÃO peça de novo o @ nem o link (você já tem), e não interprete como pedido para ele te seguir. Fale sobre esse perfil.`
    : "";

  const system = [
    `QUEM É QUEM: você fala PELA NOSSA EMPRESA (o lado que mandou a abordagem — mensagens "assistant" e as marcadas [equipe]). O contato é a pessoa/negócio que recebeu a abordagem. NUNCA escreva como se fosse o contato (ex.: "sou eu que cuido do negócio", "quero ver o que vocês encontraram") — essas falas são DELE, não suas.`,
    `Você atende o DIRECT DO INSTAGRAM de uma empresa. Estilo: mensagens curtas de chat (1 a 3 bolhas de no máximo ~2 frases), tom humano e natural, no idioma do contato.`,
    continuityBlock,
    resumeBlock,
    objectionBlock,
    notLeadBlock,
    inviteGuard,
    groundingBlock,
    flowBlock,
    handleBlock,
    assistant.discloseAi
      ? "Você PODE se apresentar como assistente de IA, com leveza."
      : "Não afirme nem negue ser uma IA; simplesmente atenda bem.",
    `\n# MANUAL DA EMPRESA (sua diretriz principal)\n${assistant.manual}`,
    learnings,
    checklist,
    prospectBlock,
    catalog,
    scheduling,
    `\n# CONTEXTO\n- Contato: ${conv.participantUsername ? "@" + conv.participantUsername : "sem @ identificado"}.\n- ${followLine}\n- Mensagens do histórico marcadas [equipe] foram enviadas manualmente por um humano do time — use-as como contexto do que já foi dito. "[equipe]" é uma ETIQUETA INTERNA: JAMAIS escreva "[equipe]" (ou qualquer marcador entre colchetes) nas suas mensagens.\n- Você está no meio de uma conversa que a equipe começou: continue de onde ela parou. Nunca reinicie do zero, nunca reapresente a empresa e nunca peça algo que o contato já respondeu.`,

    `\n# O QUE NÃO FAZER (erros que já aconteceram aqui)
- Frase de enchimento sem informação ("isso pode ajudar a otimizar seu negócio", "que bom que você está aqui"). Toda bolha precisa dizer algo concreto ou fazer a conversa avançar; se não tem o que dizer, mande menos bolhas.
- Perguntar "qual sua maior dificuldade" logo depois que o contato aceitou ver algo — primeiro entregue, depois pergunte.
- Pedir dado que já está no histórico (@ do perfil, nome do negócio, link).
- Tratar um link/perfil enviado pelo contato como pedido de follow.
- Prometer análise para depois sem entregar nada agora: entregue pelo menos um ponto concreto na hora.`,
    `\n# NÃO PERGUNTE O QUE JÁ FOI RESPONDIDO
- As mensagens marcadas [equipe] são NOSSAS (a abordagem de prospecção costuma ser uma delas). Uma pergunta feita ali JÁ FOI FEITA — se o contato respondeu, use a resposta e avance; NUNCA repita a pergunta, nem com outras palavras.
- Antes de perguntar qualquer coisa, confira no histórico se o contato já disse aquilo. Respostas curtas contam ("os dois", "sim", "pelo Google").
- Quando o contato manda várias mensagens seguidas (cumprimento + resposta), responda o CONTEÚDO, não só o cumprimento: no máximo um "bom dia" rápido e já siga a partir do que ele respondeu.`,
    `\n# FORMATO DA RESPOSTA\nResponda SOMENTE com um JSON válido, sem texto fora dele:\n{"reply": ["bolha 1", "bolha 2 (opcional)"], "action": "NONE"}\n- "reply": 1 a 3 bolhas CURTAS; resposta simples = 1 bolha; UMA pergunta no máximo, na última bolha; no máximo 1 emoji no total.\n- "action": "NONE" para continuar conversando; "HANDOFF" quando o contato pedir atendimento humano ou você não souber ajudar (nesse caso "reply" avisa que alguém do time vai assumir).${igScheduling ? `\n- "AGENDAR" quando o contato escolher um horário: {"reply": [], "action": "AGENDAR", "agendarInicio": "S1", "agendarEmail": "contato@email.com ou null"} — sem o "agendarInicio" o agendamento NÃO acontece.` : ""}\n- Se não houver nada útil a dizer, responda {"reply": [], "action": "NONE"}.`,
  ]
    .filter(Boolean)
    .join("\n");

  const chat: ChatMessage[] = [{ role: "system", content: system }];
  // Resposta automática do robô do contato no meio de falas reais vai
  // marcada — o modelo responde a pessoa, não o menu.
  const botTag = (t: string) => (AUTO_REPLY_RE.test(t) ? "[resposta automática do robô do contato] " : "");
  for (const m of history) {
    if (!m.text?.trim()) continue;
    const role: ChatMessage["role"] = m.direction === "IN" ? "user" : "assistant";
    const prefix =
      m.direction === "OUT" && (m.source === "EXTERNAL" || m.source === "AGENT")
        ? "[equipe] "
        : m.direction === "IN"
          ? botTag(m.text)
          : "";
    const content = prefix + m.text;
    // Mensagens seguidas do mesmo lado viram UM turno: "Oie bom dia" +
    // "Tudo bem?" + "Os dois" é uma fala só. Em turnos separados o modelo
    // respondia o cumprimento e deixava a resposta de verdade pra trás.
    const prev = chat[chat.length - 1];
    if (prev && prev.role === role && chat.length > 1) prev.content += "\n" + content;
    else chat.push({ role, content });
  }

  // Trava final: o último turno TEM que ser do contato. Se for nosso, o
  // modelo "continua o diálogo" escrevendo a fala do outro lado.
  if (chat[chat.length - 1]?.role !== "user") return skip("ultimo_turno_nao_e_do_contato");

  const result = await runAssistant({
    companyId: conv.companyId,
    endpoint: "ig-auto-agent",
    messages: chat,
    assistantId: assistant.id,
    model: assistant.model,
    temperature: assistant.temperature,
    maxTokens: MAX_REPLY_TOKENS,
  });
  if (!result.ok) return skip(`ia_${result.code}`, { error: result.error });

  let decision: AgentDecision =
    parseDecision(result.text) ?? { reply: [result.text.trim()].filter(Boolean).slice(0, 1), action: "NONE" };

  // TRAVA: handoff em cima de objeção é o erro mais caro do Direct — o contato
  // diz "já temos quem cuida", o agente responde "já passei pro Diego" e a
  // conversa morre pausada. O prompt já proíbe; aqui o motor confere e manda
  // responder de novo, agora tratando a objeção.
  if (decision.action === "HANDOFF" && contactObjected) {
    console.warn(`[IgAgent] handoff em objeção conv=${conv.id} — refazendo a resposta`);
    const retry = await runAssistant({
      companyId: conv.companyId,
      endpoint: "ig-auto-agent",
      messages: [
        ...chat,
        {
          role: "system",
          content:
            '⛔ NÃO passe pro humano e NÃO diga que vai passar pro Diego: o contato levantou uma OBJEÇÃO comum de prospecção ("já temos quem cuida"), não um assunto fora de escopo. Responda você: respeite quem já cuida em meia frase, entregue UM achado concreto dos ACHADOS DA EQUIPE e feche com uma pergunta leve. Use action "NONE".',
        },
      ],
      assistantId: assistant.id,
      model: assistant.model,
      temperature: assistant.temperature,
      maxTokens: MAX_REPLY_TOKENS,
    });
    const second = retry.ok ? parseDecision(retry.text) : null;
    if (second && second.action === "NONE" && second.reply.length) {
      decision = second;
      recordRun({ conv: conv.id, handoffEmObjecao: true });
    }
  }

  // Reconfere que ninguém respondeu enquanto a IA pensava.
  const fresh = await prisma.igConversation.findUnique({
    where: { id: conv.id },
    select: { lastDirection: true, aiMode: true },
  });
  if (!fresh || fresh.lastDirection !== "IN" || fresh.aiMode !== "ACTIVE") return skip("respondida_durante_ia");
  // O contato escreveu de novo enquanto a IA pensava: a resposta pronta não
  // leva em conta a mensagem nova e, se saísse, deixaria a conversa como
  // respondida — a rodada da mensagem nova pularia ("ja_respondida") e ela
  // seria engolida. Descarta e reagenda pra responder tudo junto.
  const newerIn = await prisma.igMessage.findFirst({
    where: { conversationId: conv.id, direction: "IN", createdAt: { gt: lastIn.createdAt } },
    select: { id: true },
  });
  if (newerIn) {
    scheduleIgAutoAgent(conv.id);
    return skip("contato_escreveu_durante_ia");
  }

  // Envio de uma bolha — reaproveitado pelo agendamento.
  const sendBubble = async (text: string): Promise<boolean> => {
    try {
      const mid = await sendMessageToUser(conv.participantId, text, token);
      await recordIgMessage({
        companyId: conv.companyId,
        channel: "INSTAGRAM",
        connectionId: conv.connectionId ?? conv.accountId ?? conv.participantId,
        accountId: conv.accountId,
        participantId: conv.participantId,
        direction: "OUT",
        source: "AI",
        text,
        mid,
      });
      return true;
    } catch (e: any) {
      console.error(`[IgAgent] envio falhou conv=${conv.id}:`, e?.message);
      recordRun({ conv: conv.id, error: `envio: ${e?.message?.slice(0, 200)}` });
      return false;
    }
  };

  // AGENDAR: quem confirma é o motor (revalida o horário, cria o evento e manda
  // o Meet). As bolhas do modelo são ignoradas — nessa action ele devolve [].
  if (decision.action === "AGENDAR") {
    if (!igScheduling) return skip("agendar_sem_agenda");
    const lastOut = [...history].reverse().find((m) => m.direction === "OUT");
    const marcou = await bookIgMeeting({
      conv: { id: conv.id, companyId: conv.companyId, participantUsername: conv.participantUsername },
      scheduling: igScheduling,
      decision,
      contactText: lastIn.text ?? "",
      lastOutText: lastOut?.text ?? null,
      inboundTexts: history.filter((m) => m.direction === "IN").map((m) => m.text ?? ""),
      lead,
      send: sendBubble,
    });
    recordRun({ conv: conv.id, action: "AGENDAR", agendado: marcou });
    persistIgResult(conv.id, marcou ? "ok:AGENDAR" : "agendar_nao_concluido");
    console.log(`[IgAgent] conv=${conv.id} action=AGENDAR agendado=${marcou}`);
    return;
  }

  for (const bubble of decision.reply) {
    if (!(await sendBubble(bubble))) {
      persistIgResult(conv.id, "envio_falhou");
      return;
    }
    if (decision.reply.length > 1) await new Promise((r) => setTimeout(r, BUBBLE_DELAY_MS));
  }

  if (decision.action === "HANDOFF") {
    // aiPausedBy="AI": foi o agente que saiu de cena, não um atendente. Se o
    // contato continuar falando e ninguém do time entrar, o agente volta UMA vez.
    await prisma.igConversation.update({
      where: { id: conv.id },
      data: { aiMode: "PAUSED_HUMAN", needsReply: true, aiPausedBy: "AI" } as any,
    });
  }

  recordRun({ conv: conv.id, action: decision.action, bubbles: decision.reply.length, follows });
  persistIgResult(conv.id, `ok:${decision.action}${decision.reply.length ? "" : ":sem_envio"}`);
  console.log(`[IgAgent] conv=${conv.id} action=${decision.action} bolhas=${decision.reply.length}`);
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * Confirma a conversa escolhida pelo contato: revalida o horário (nunca marca
 * em cima de compromisso), cria o evento com Google Meet, manda a confirmação
 * no Direct e registra no lead. Devolve false quando não deu pra marcar — aí a
 * própria função já falou com o contato (pedindo o horário ou oferecendo outro).
 */
async function bookIgMeeting(args: {
  conv: { id: string; companyId: string; participantUsername: string | null };
  scheduling: IgScheduling;
  decision: AgentDecision;
  contactText: string;
  lastOutText: string | null;
  inboundTexts: string[];
  lead: { id: string; name: string | null; email: string | null; notes: string | null } | null;
  send: (text: string) => Promise<boolean>;
}): Promise<boolean> {
  const { conv, scheduling, decision, contactText, lastOutText, inboundTexts, lead, send } = args;

  const offered = slotsWeOffered(lastOutText, scheduling.slots);
  const slot = resolveIgSlot(scheduling.slots, decision.agendarInicio, contactText, offered);
  // O contato TEM que ter escolhido: precisa ter havido oferta nossa e sinal
  // dele (citou o horário ou concordou). Sem isso o agente marcaria sozinho —
  // evento real na agenda que ninguém pediu.
  const escolheu =
    offered.length > 0 &&
    (looksLikeAcceptance(contactText) || scheduling.slots.some((sl) => mentionsSlot(contactText, sl).time));

  if (!slot || !escolheu) {
    console.warn(`[IgAgent] AGENDAR sem escolha clara conv=${conv.id} (slot=${slot?.label ?? "-"}, oferecidos=${offered.length})`);
    const opts = pickTwo(offered.length ? offered : scheduling.slots).map(prettySlot);
    await send(
      opts.length >= 2
        ? `Deixa eu confirmar o horário: consigo ${opts[0]} ou ${opts[1]}. Qual fecha pra você?`
        : opts.length === 1
          ? `Deixa eu confirmar: consigo ${opts[0]} — fecha pra você?`
          : "Me diz o dia e o horário que ficam melhores pra você que eu confiro aqui.",
    );
    return false;
  }

  let livre = false;
  try {
    livre = await isSlotStillFree(scheduling.connectionId, slot.startISO, scheduling.durationMin);
  } catch (err: any) {
    console.error(`[IgAgent] falha ao revalidar horário conv=${conv.id}:`, err?.message);
  }
  if (!livre) {
    let alt = "";
    try {
      const frescos = await computeAvailableSlots({
        companyId: conv.companyId,
        connectionId: scheduling.connectionId,
        durationMin: scheduling.durationMin,
        maxSlots: 8,
      });
      const opts = pickTwo(frescos).map(prettySlot);
      if (opts.length) alt = ` Consigo ${opts.join(" ou ")} — algum desses te atende?`;
    } catch { /* sem alternativa, vai só o aviso */ }
    await send(`Poxa, esse horário acabou de ser preenchido aqui 😅${alt}`);
    return false;
  }

  // E-mail: o modelo inventa endereço quando não tem um. Só vale o que o
  // contato digitou no Direct (ou o que já está no cadastro do lead).
  const digitados = inboundTexts
    .flatMap((t) => t.match(EMAIL_RE) ?? [])
    .map((e) => e.toLowerCase())
    .filter((e) => !PLACEHOLDER_EMAIL_RE.test(e));
  const doModelo = decision.agendarEmail?.toLowerCase() ?? null;
  const attendeeEmail =
    (doModelo && digitados.includes(doModelo) ? doModelo : null) ??
    digitados[0] ??
    (lead?.email && !PLACEHOLDER_EMAIL_RE.test(lead.email) ? lead.email : null);

  const quem = lead?.name ?? (conv.participantUsername ? `@${conv.participantUsername}` : "contato do Instagram");
  let booked;
  try {
    booked = await createMeetEvent({
      connectionId: scheduling.connectionId,
      startISO: slot.startISO,
      durationMin: scheduling.durationMin,
      summary: `Conversa de ${scheduling.durationMin} min — ${quem}`,
      description: [
        `Prospect do Instagram${conv.participantUsername ? ` (@${conv.participantUsername})` : ""}.`,
        attendeeEmail ? `E-mail: ${attendeeEmail}` : null,
        "Agendado pelo agente de IA do Direct (LeadHub).",
      ].filter(Boolean).join("\n"),
      attendeeEmail,
    });
  } catch (err: any) {
    console.error(`[IgAgent] falha ao criar evento conv=${conv.id}:`, err?.message);
    await send("Tive um probleminha pra confirmar aqui 😅 Vou pedir pro time garantir seu horário, tá?");
    await prisma.igConversation
      .update({ where: { id: conv.id }, data: { aiMode: "PAUSED_HUMAN", needsReply: true, aiPausedBy: "AI" } as any })
      .catch(() => {});
    return false;
  }

  await send(`Fechado! Nossa conversa está marcada pra ${prettySlot(booked)} 🎉`);
  await new Promise((r) => setTimeout(r, BUBBLE_DELAY_MS));
  await send(
    booked.meetLink
      ? `Aqui o link do Google Meet: ${booked.meetLink}${attendeeEmail ? " — o convite também foi pro seu e-mail 😉" : ""}`
      : "O convite com o link da conversa foi pro seu e-mail 😉",
  );

  if (lead) {
    const stamp = `Conversa agendada pelo agente do Direct: ${prettySlot(booked)}${attendeeEmail ? ` · convite pra ${attendeeEmail}` : ""}${booked.meetLink ? `\nMeet: ${booked.meetLink}` : ""}`;
    await prisma.lead
      .update({ where: { id: lead.id }, data: { notes: lead.notes ? `${lead.notes}\n\n${stamp}` : stamp } })
      .catch(() => {/* acessório */});
  }

  console.log(`[IgAgent] reunião marcada conv=${conv.id} em ${booked.label}`);
  return true;
}
