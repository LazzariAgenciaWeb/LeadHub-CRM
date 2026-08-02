import { LeadStatus } from "@/generated/prisma";
import { prisma } from "./prisma";
import { runAssistant, getAssistantForInstance, getServicesCatalogBlock, type ChatMessage } from "./assistant";
import { evolutionSendText } from "./evolution";
import { upsertConversation } from "./whatsapp";
import { sendPushToUser } from "./push";
import {
  getAgentCalendarConnection, connectionCanWrite, computeAvailableSlots,
  isSlotStillFree, createMeetEvent, nowLabel, type Slot,
} from "./scheduling";

/**
 * Agente autônomo de atendimento (triagem).
 *
 * Fluxo: mensagem INBOUND chega no webhook → scheduleAutoAgent() agenda o
 * processamento com debounce (mensagens picadas viram UMA resposta) →
 * runAutoAgentNow() monta o prompt (manual + aprendizados + catálogo +
 * histórico), pede um JSON estruturado à IA e executa a ação:
 *
 *   NONE      → só responde e segue conversando/qualificando
 *   <intent>  → rota cadastrada em AssistantRoute (ex.: COMERCIAL, ATENDIMENTO):
 *               move a conversa pro setor, opcionalmente cria/atualiza Lead,
 *               registra nota de triagem, notifica o time e SILENCIA o bot
 *   HANDOFF   → contato pediu humano (ou a IA não sabe): silencia e notifica
 *
 * O bot NUNCA responde: grupos, conversas com aiMode != ACTIVE (humano assumiu
 * ou bot desligado) e instâncias sem agente autoRespond. Toda chamada passa
 * pelo runAssistant() → cota mensal da empresa + AiUsageLog valem aqui.
 */

// Revisão do motor — aparece no GET /api/webhook/whatsapp pra conferir em
// segundos qual versão está no ar após um deploy.
export const AUTO_AGENT_REV = "v5-diagnostico-runtime";

// Diagnóstico: últimas execuções do motor (motivo de skip, estado da agenda,
// action tomada). Exposto no GET /api/webhook/whatsapp — memória do processo,
// zera no restart. Sem conteúdo de mensagem (só metadados).
const recentRuns: Record<string, unknown>[] = (globalThis as any).__autoAgentRuns ?? [];
(globalThis as any).__autoAgentRuns = recentRuns;
export function getRecentAutoAgentRuns() {
  return recentRuns;
}
function recordRun(entry: Record<string, unknown>) {
  recentRuns.unshift({ ts: new Date().toISOString(), ...entry });
  if (recentRuns.length > 12) recentRuns.pop();
}

const DEBOUNCE_MS = 10_000;
const HISTORY_LIMIT = 30;
const MAX_REPLY_TOKENS = 500;
const MAX_BUBBLE_CHARS = 200; // acima disso o motor quebra a bolha na marra

// Debounce por conversa. Vive em globalThis pra sobreviver ao HMR do dev.
// Servidor único (standalone) — suficiente pra Fase 1; se um dia houver
// réplicas, trocar por fila (pg-boss).
const timers: Map<string, ReturnType<typeof setTimeout>> =
  (globalThis as any).__autoAgentTimers ?? new Map();
(globalThis as any).__autoAgentTimers = timers;

/**
 * Agenda o processamento da conversa com debounce. Chamar a cada INBOUND
 * (o webhook chama; é barato — os guards pesados rodam só quando dispara).
 */
export function scheduleAutoAgent(conversationId: string): void {
  const existing = timers.get(conversationId);
  if (existing) clearTimeout(existing);
  timers.set(
    conversationId,
    setTimeout(() => {
      timers.delete(conversationId);
      runAutoAgentNow(conversationId).catch((err) =>
        console.error(`[AutoAgent] erro conv=${conversationId}:`, err)
      );
    }, DEBOUNCE_MS)
  );
}

/**
 * Pausa o bot numa conversa (humano assumiu ou desligado manualmente).
 * Idempotente e nunca lança — seguro pra chamar de qualquer fluxo de envio.
 */
export async function pauseBot(
  conversationId: string,
  mode: "PAUSED_HUMAN" | "OFF" = "PAUSED_HUMAN"
): Promise<void> {
  const t = timers.get(conversationId);
  if (t) {
    clearTimeout(t);
    timers.delete(conversationId);
  }
  await prisma.conversation
    .updateMany({
      where: { id: conversationId, aiMode: "ACTIVE" },
      data: { aiMode: mode, aiPausedAt: new Date() },
    })
    .catch(() => {/* nunca propaga */});
}

/** Reativa o bot numa conversa (botão da Inbox). */
export async function resumeBot(conversationId: string): Promise<void> {
  await prisma.conversation
    .updateMany({
      where: { id: conversationId },
      data: { aiMode: "ACTIVE", aiPausedAt: null },
    })
    .catch(() => {/* nunca propaga */});
}

// ── Núcleo ────────────────────────────────────────────────────────────────────

interface AgentDecision {
  replies: string[]; // 0-3 mensagens curtas, enviadas em sequência
  action: string; // "NONE" | "HANDOFF" | "AGENDAR" | intent de AssistantRoute
  resumo: string | null;
  agendarInicio: string | null; // ISO do slot escolhido (action AGENDAR)
  agendarEmail: string | null; // e-mail do contato pro convite (action AGENDAR)
}

/**
 * Extrai o JSON da resposta da IA de forma tolerante (com/sem cerca de código,
 * texto em volta). `reply` aceita string única OU lista de mensagens curtas
 * (estilo WhatsApp real — várias bolhas). Retorna null se não houver JSON.
 */
function parseDecision(raw: string): AgentDecision | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    const rawReply: unknown[] = Array.isArray(obj.reply) ? obj.reply : [obj.reply];
    const replies = normalizeBubbles(
      rawReply
        .filter((r): r is string => typeof r === "string")
        .map((r) => r.trim())
        .filter(Boolean)
    );
    const action = typeof obj.action === "string" && obj.action.trim() ? obj.action.trim().toUpperCase() : "NONE";
    const resumo = typeof obj.resumo === "string" && obj.resumo.trim() ? obj.resumo.trim() : null;
    const agendarInicio = typeof obj.agendarInicio === "string" && obj.agendarInicio.trim() ? obj.agendarInicio.trim() : null;
    const agendarEmail = typeof obj.agendarEmail === "string" && obj.agendarEmail.includes("@") ? obj.agendarEmail.trim() : null;
    return { replies, action, resumo, agendarInicio, agendarEmail };
  } catch {
    return null;
  }
}

/**
 * Backstop MECÂNICO do estilo: o modelo às vezes ignora a instrução e devolve
 * um parágrafo único. Aqui qualquer bolha acima de MAX_BUBBLE_CHARS é quebrada
 * em sentenças e reagrupada em bolhas curtas; máximo 3 bolhas no total (o
 * excedente é fundido na última — nunca se perde conteúdo).
 */
function normalizeBubbles(replies: string[]): string[] {
  const out: string[] = [];
  for (const r of replies) {
    if (r.length <= MAX_BUBBLE_CHARS) {
      out.push(r);
      continue;
    }
    const sentences = r.split(/(?<=[.!?…])\s+/);
    let cur = "";
    for (const s of sentences) {
      if (!cur) cur = s;
      else if (cur.length + 1 + s.length <= MAX_BUBBLE_CHARS) cur += " " + s;
      else { out.push(cur); cur = s; }
    }
    if (cur) out.push(cur);
  }
  if (out.length > 3) return [out[0], out[1], out.slice(2).join(" ")];
  return out;
}

interface SchedulingContext {
  connectionId: string;
  durationMin: number;
  slots: Slot[];
}

function schedulingPromptBlock(ctx: SchedulingContext): string {
  const manha = ctx.slots.filter((s) => s.period === "manha").slice(0, 8);
  const tarde = ctx.slots.filter((s) => s.period === "tarde").slice(0, 8);
  const fmt = (list: Slot[]) => (list.length ? list.map((s) => `${s.startISO} = ${s.label}`).join(" | ") : "(nenhum)");

  return `# AGENDAMENTO DIRETO (você mesmo marca a reunião — NÃO envie link de agenda)
⚠️ ESTA SEÇÃO SOBRESCREVE qualquer instrução do manual sobre agendamento (link de agenda, "pedir pro gestor verificar", "enviar o link"). VOCÊ tem acesso direto à agenda: os horários LIVRES estão listados abaixo. Se o contato pedir pra "verificar a disponibilidade", NÃO diga que um gestor vai verificar — VOCÊ verifica: ofereça 2 opções da lista imediatamente.
Agora: ${nowLabel()} (horário de Brasília). Reunião de ${ctx.durationMin} minutos no Google Meet.
Horários LIVRES na agenda:
MANHÃ: ${fmt(manha)}
TARDE: ${fmt(tarde)}

Regras do agendamento:
- Ofereça no MÁXIMO 2 opções por vez: 1 de manhã e 1 de tarde (das listas acima). Se um período não tiver horário, ofereça 2 do outro.
- Ofereça SOMENTE horários que estão nas listas. NUNCA invente nem confirme horário fora delas.
- NUNCA agende ou prometa horário pra HOJE — as listas já começam no próximo dia útil; se o contato pedir "hoje", explique com leveza que a agenda abre a partir de amanhã e ofereça as opções.
- Se nenhum servir pro contato, pergunte a preferência dele (dia/período) e ofereça outras 2 opções das listas.
- Antes de confirmar, peça o E-MAIL do contato ("pra te enviar o convite da reunião 😊").
- Quando o contato ESCOLHER um horário e informar o e-mail, use action "AGENDAR" com:
  "agendarInicio" = o valor ISO EXATO da lista (ex.: "${ctx.slots[0]?.startISO ?? "2026-01-01T09:00:00-03:00"}")
  "agendarEmail" = o e-mail informado
  e deixe "reply" vazio ([]) — o sistema confirma e envia o link do Meet automaticamente.
- Se as listas estiverem vazias (sem horário livre), avise que o time vai retornar pra combinar o melhor horário e use action "HANDOFF". NUNCA confirme reunião sem horário livre.`;
}

function buildSystemPrompt(args: {
  manual: string;
  learnings: string | null;
  schedulingLink: string | null;
  qualificationChecklist: string | null;
  servicesBlock: string;
  routes: { intent: string; label: string | null; setorName: string }[];
  scheduling: SchedulingContext | null;
}): string {
  const { manual, learnings, schedulingLink, qualificationChecklist, servicesBlock, routes, scheduling } = args;

  const routeLines = routes
    .map((r) => `- "${r.intent}" → encaminha pro setor ${r.label ?? r.setorName}. Use quando o contato foi identificado/qualificado como esse caso.`)
    .join("\n");

  const checklistItems = (qualificationChecklist ?? "")
    .split("\n")
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter(Boolean);

  const parts: string[] = [];

  parts.push(`# PAPEL
Você é um atendente da empresa respondendo mensagens de WhatsApp. Converse de forma natural e calorosa. Nunca invente informações, preços ou prazos que não estejam no manual/catálogo abaixo.

Identidade:
- NÃO se apresente como "assistente virtual", "IA", "bot" ou "atendimento automático". Você é simplesmente alguém do time — desenrole a conversa como uma pessoa faria.
- Não use frases robóticas ("digite 1 para...", "em que posso ajudá-lo hoje?"). Fale como gente.
- Se o contato perguntar DIRETAMENTE se você é um robô/IA, NÃO minta: responda leve ("aqui é do time da empresa 🙂 vou te passar com alguém agora") e use action "HANDOFF".

# ESTILO DAS MENSAGENS (obrigatório)
- CURTO: cada mensagem tem 1-2 frases no máximo. Nada de parágrafos longos ou textões.
- VARIE o número de bolhas: resposta simples = 1 bolha; só use 2-3 quando realmente tem mais de uma ideia. Sempre 3 bolhas parece script.
- UMA pergunta por vez, sempre a última mensagem da sequência.
- Emojis: no máximo 1 por RESPOSTA (não por bolha), e varie (😊 🚀 👍 🤝 ✨ 😉) — a maioria das mensagens fica SEM emoji. Repetir o mesmo emoji toda hora entrega robô.
- NUNCA repita um convite ou proposta que o contato já recusou ou ignorou (ex.: agendar reunião). Recusou? Mude a abordagem: explique em 1 frase POR QUE precisa entender o contexto e siga coletando as informações pela própria conversa.
- Não repita o nome do contato em toda mensagem — soa robótico. Use no máximo 1x a cada 3-4 mensagens.
- Não comece as frases sempre do mesmo jeito ("Assim, ..." / "Perfeito!") — varie a abertura.`);

  parts.push(`# MANUAL DO AGENTE (siga à risca)\n${manual.trim()}`);

  if (learnings?.trim()) {
    parts.push(`# APRENDIZADOS (correções e orientações acumuladas — têm prioridade sobre o manual em caso de conflito)\n${learnings.trim()}`);
  }

  if (checklistItems.length) {
    parts.push(`# INFORMAÇÕES OBRIGATÓRIAS (colete TODAS antes de agendar/encaminhar pra reunião)
${checklistItems.map((c) => `- ${c}`).join("\n")}

Regras de coleta:
- Colete no meio da conversa, de forma NATURAL — uma informação por mensagem, encaixada no assunto. NUNCA despeje as perguntas como formulário/questionário.
- O que o contato já disse espontaneamente conta como coletado — não pergunte de novo.
- Só ofereça agendar reunião/horário depois que TODAS estiverem coletadas.
- Inclua todas as respostas coletadas no campo "resumo" ao encaminhar.`);
  }

  if (scheduling) {
    // Agendamento direto na agenda conectada — substitui o link estático.
    parts.push(schedulingPromptBlock(scheduling));
  } else if (schedulingLink?.trim()) {
    parts.push(`# LINK DE AGENDAMENTO\nQuando for agendar, envie EXATAMENTE esta URL: ${schedulingLink.trim()}`);
  }

  if (servicesBlock) parts.push(servicesBlock.trim());

  parts.push(`# SUA MISSÃO NESTA CONVERSA
1. Entender o que o contato quer (interprete livremente — não há menu de opções).
2. Qualificar com perguntas naturais, UMA por vez${checklistItems.length ? " (priorize as INFORMAÇÕES OBRIGATÓRIAS acima)" : ""}.
3. Quando estiver claro pra qual time vai, encaminhe usando a action correta.

# ACTIONS DISPONÍVEIS
- "NONE" → continuar conversando (ainda entendendo/qualificando).
${routeLines}
${scheduling ? `- "AGENDAR" → confirmar a reunião escolhida (siga as regras da seção AGENDAMENTO DIRETO).\n` : ""}- "HANDOFF" → o contato pediu pra falar com uma pessoa, está irritado, ou você NÃO sabe responder com segurança. Nunca insista em segurar alguém que pediu humano.

# REGRAS DE ENCAMINHAMENTO
- Ao encaminhar (qualquer action ≠ NONE), o "reply" deve avisar o contato de forma simpática que o time certo vai assumir a conversa. Depois disso você para de responder.
- Se o contato mandou áudio, imagem ou arquivo (aparece como "🎵 Áudio", "🖼️ Imagem", "📎 ..." no histórico), diga educadamente que por aqui você atende por texto e peça pra escrever.

# FORMATO DA RESPOSTA (obrigatório)
Responda SOMENTE com um JSON válido, sem texto fora dele, neste formato:
{"reply": ["primeira mensagem curta", "segunda mensagem curta (opcional)"], "action": "NONE", "resumo": "1 frase objetiva: quem é o contato e o que quer"}
- "reply": lista de 1 a 3 mensagens curtas (enviadas em sequência, como bolhas separadas). Pode ser string única. null/[] se não deve responder nada.
- O campo "resumo" é interno (o time lê) — sempre preencha da melhor forma possível.`);

  return parts.join("\n\n");
}

type AgentRunResult =
  | { ok: true; action: string; replied: boolean }
  | { ok: false; skipped: string };

/**
 * Processa a conversa AGORA (chamado pelo debounce; exportado também pra
 * testes/diagnóstico). Registra cada execução em recentRuns.
 */
export async function runAutoAgentNow(conversationId: string): Promise<AgentRunResult> {
  const diag: Record<string, unknown> = {};
  try {
    const res = await runAutoAgentCore(conversationId, diag);
    recordRun({ conv: conversationId, ...diag, ...res });
    return res;
  } catch (err) {
    recordRun({ conv: conversationId, ...diag, error: String(err) });
    throw err;
  }
}

/** Núcleo do processamento — todos os guards vivem aqui. */
async function runAutoAgentCore(conversationId: string, diag: Record<string, unknown>): Promise<AgentRunResult> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true, phone: true, isGroup: true, status: true, aiMode: true,
      companyId: true, setorId: true, assigneeId: true,
    },
  });

  if (!conv) return { ok: false, skipped: "conv_not_found" };
  if (conv.isGroup) return { ok: false, skipped: "group" };
  if (conv.aiMode !== "ACTIVE") return { ok: false, skipped: `aiMode_${conv.aiMode}` };
  if (conv.status === "CLOSED") return { ok: false, skipped: "closed" };

  // Última mensagem precisa ser INBOUND — se humano (ou o próprio bot) já
  // respondeu depois dela, não há o que fazer.
  const last = await prisma.message.findFirst({
    where: { conversationId: conv.id },
    orderBy: { receivedAt: "desc" },
    select: { id: true, direction: true, instanceId: true, receivedAt: true },
  });
  if (!last || last.direction !== "INBOUND") return { ok: false, skipped: "last_not_inbound" };
  if (!last.instanceId) return { ok: false, skipped: "no_instance" };

  const instance = await prisma.whatsappInstance.findUnique({
    where: { id: last.instanceId },
    select: { id: true, instanceName: true, instanceToken: true, status: true },
  });
  if (!instance) return { ok: false, skipped: "instance_not_found" };

  // Agente autônomo da instância (independe do type — roteamento por número)
  const assistant = await getAssistantForInstance(conv.companyId, instance.id);
  if (!assistant || !assistant.isActive || !(assistant as any).autoRespond) {
    return { ok: false, skipped: "no_auto_assistant" };
  }

  const routes = await prisma.assistantRoute.findMany({
    where: { assistantId: assistant.id },
    include: { setor: { select: { id: true, name: true } } },
  });

  // Histórico recente (ordem cronológica)
  const history = await prisma.message.findMany({
    where: { conversationId: conv.id },
    orderBy: { receivedAt: "desc" },
    take: HISTORY_LIMIT,
    select: { body: true, direction: true, receivedAt: true },
  });
  history.reverse();

  const servicesBlock = await getServicesCatalogBlock(conv.companyId);

  // Agendamento direto: agenda Google do usuário vinculado + slots livres
  // (agenda ∩ horários de atendimento). Qualquer falha → fallback pro link.
  let scheduling: SchedulingContext | null = null;
  const calendarUserId = (assistant as any).calendarUserId as string | null;
  if (!calendarUserId) {
    diag.agenda = "agente_sem_agenda_salva";
  } else {
    try {
      const connCal = await getAgentCalendarConnection(calendarUserId);
      if (!connCal) {
        diag.agenda = "sem_conexao_ativa";
      } else if (!connectionCanWrite(connCal)) {
        diag.agenda = "sem_escopo_escrita";
        console.warn(`[AutoAgent] conexão calendar sem escopo de escrita (user=${calendarUserId}) — reconectar a conta; usando fallback de link`);
      } else {
        const durationMin = ((assistant as any).meetingDurationMin as number) || 30;
        const slots = await computeAvailableSlots({
          companyId: conv.companyId,
          connectionId: connCal.id,
          durationMin,
        });
        scheduling = { connectionId: connCal.id, durationMin, slots };
        diag.agenda = `ok_${slots.length}_slots`;
      }
    } catch (err: any) {
      diag.agenda = `erro: ${err?.message ?? String(err)}`;
      console.error(`[AutoAgent] falha ao montar agenda conv=${conv.id} (fallback pro link):`, err);
    }
  }

  const system = buildSystemPrompt({
    manual: assistant.manual,
    learnings: (assistant as any).learnings ?? null,
    schedulingLink: assistant.schedulingLink,
    qualificationChecklist: (assistant as any).qualificationChecklist ?? null,
    servicesBlock,
    routes: routes.map((r) => ({ intent: r.intent, label: r.label, setorName: r.setor.name })),
    scheduling,
  });

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...history.map((m): ChatMessage => ({
      role: m.direction === "INBOUND" ? "user" : "assistant",
      content: m.body,
    })),
    // Lembrete FINAL depois do histórico — modelos seguem melhor a última
    // instrução, e o histórico com mensagens longas antigas puxa o estilo
    // de volta pro textão se não reforçar aqui.
    {
      role: "system",
      content: `LEMBRETE FINAL (obrigatório): responda SOMENTE o JSON. "reply" = 1 a 3 bolhas CURTAS (máx ~2 frases / ${MAX_BUBBLE_CHARS} caracteres cada) — NUNCA um parágrafo único longo, mesmo que as mensagens antigas do histórico sejam longas. VARIE: resposta simples = 1 bolha só; não feche sempre em 3. No máximo 1 emoji na resposta inteira (varie o emoji; quase sempre nenhum). UMA pergunta só, na última bolha. Não use o nome do contato se já usou nas últimas mensagens. NUNCA repita convite/link que o contato já recusou ou ignorou.${scheduling ? " ATENÇÃO: você TEM a seção AGENDAMENTO DIRETO com horários livres da agenda — ofereça horários DELA; NUNCA diga que um gestor vai verificar disponibilidade e NUNCA envie link de agenda." : ""}`,
    },
  ];

  const result = await runAssistant({
    companyId: conv.companyId,
    endpoint: "auto-agent",
    messages,
    assistantId: assistant.id,
    model: assistant.model,
    temperature: assistant.temperature,
    maxTokens: MAX_REPLY_TOKENS,
  });

  if (!result.ok) {
    // Cota/config/erro → silêncio (nunca expor erro interno ao contato).
    console.warn(`[AutoAgent] runAssistant falhou conv=${conv.id}: ${result.code} — ${result.error}`);
    return { ok: false, skipped: `ai_${result.code}` };
  }

  const decision = parseDecision(result.text);
  if (!decision) {
    console.warn(`[AutoAgent] resposta sem JSON utilizável conv=${conv.id}: "${result.text.slice(0, 200)}"`);
    return { ok: false, skipped: "bad_json" };
  }
  diag.modelAction = decision.action;
  diag.bolhas = decision.replies.length;

  // Race check: se durante a chamada de IA chegou resposta de humano (ou o bot
  // foi pausado), descarta a resposta gerada.
  const fresh = await prisma.conversation.findUnique({
    where: { id: conv.id },
    select: { aiMode: true },
  });
  if (fresh?.aiMode !== "ACTIVE") return { ok: false, skipped: "paused_during_ai" };
  const newer = await prisma.message.findFirst({
    where: { conversationId: conv.id, direction: "OUTBOUND", receivedAt: { gt: last.receivedAt } },
    select: { id: true },
  });
  if (newer) return { ok: false, skipped: "human_replied_during_ai" };

  const botSender: BotSender = {
    instanceName: instance.instanceName,
    instanceId: instance.id,
    instanceToken: instance.instanceToken ?? null,
    companyId: conv.companyId,
    phone: conv.phone,
    assistantId: assistant.id,
  };

  // 1) Enviar a(s) resposta(s) ao contato — em sequência, com pausa curta
  //    entre bolhas pra soar como pessoa digitando (não metralhadora).
  //    Na action AGENDAR o motor manda a própria confirmação (pós-booking),
  //    então as replies do modelo são ignoradas.
  let replied = false;
  const repliesToSend = decision.action === "AGENDAR" ? [] : decision.replies;
  for (let i = 0; i < repliesToSend.length; i++) {
    const part = repliesToSend[i];
    if (i > 0) {
      // Pausa proporcional ao tamanho da próxima mensagem (1.5s a 4s).
      const pause = Math.min(4000, 1500 + part.length * 25);
      await new Promise((r) => setTimeout(r, pause));
    }
    const ok = await sendBotText(botSender, part);
    if (ok) {
      replied = true;
    } else {
      // Nada enviado → não roteia "às cegas"; tenta de novo na próxima msg.
      // Se já enviou parte da sequência, segue pro roteamento normalmente.
      if (!replied) return { ok: false, skipped: "send_failed" };
      break;
    }
  }

  // 2) Executar a action
  const action = decision.action;
  if (action === "AGENDAR") {
    await handleBooking({
      conversationId: conv.id,
      companyId: conv.companyId,
      phone: conv.phone,
      setorId: conv.setorId,
      sender: botSender,
      scheduling,
      decision,
      routes: routes.map((r) => ({ intent: r.intent, setorId: r.setorId, setorName: r.setor.name, createLead: r.createLead })),
    });
    return { ok: true, action, replied: true };
  }
  if (action !== "NONE") {
    const route = routes.find((r) => r.intent.toUpperCase() === action) ?? null;

    if (route) {
      await routeConversation({
        conversationId: conv.id,
        companyId: conv.companyId,
        phone: conv.phone,
        setorId: route.setorId,
        setorName: route.setor.name,
        createLead: route.createLead,
        resumo: decision.resumo,
      });
    } else if (action === "HANDOFF") {
      await handoffConversation({
        conversationId: conv.id,
        setorId: conv.setorId,
        resumo: decision.resumo,
        phone: conv.phone,
      });
    } else {
      // Action desconhecida → trata como HANDOFF defensivo (melhor um humano
      // olhar do que o bot travar a conversa).
      console.warn(`[AutoAgent] action desconhecida "${action}" conv=${conv.id} — tratando como HANDOFF`);
      await handoffConversation({
        conversationId: conv.id,
        setorId: conv.setorId,
        resumo: decision.resumo,
        phone: conv.phone,
      });
    }
  }

  return { ok: true, action, replied };
}

// ── Envio ─────────────────────────────────────────────────────────────────────

interface BotSender {
  instanceName: string;
  instanceId: string;
  instanceToken: string | null;
  companyId: string;
  phone: string;
  assistantId: string;
}

/**
 * Envia UMA mensagem de texto do bot e persiste (Conversation + Message).
 * Retorna false em falha (nunca lança).
 */
async function sendBotText(s: BotSender, text: string): Promise<boolean> {
  try {
    const sendResult = await evolutionSendText(s.instanceName, s.phone, text, s.instanceToken);
    // Prefixo "out-" no fallback: o webhook fromMe (eco do envio) reconhece
    // esse padrão e ATUALIZA o registro em vez de duplicar/pausar o bot.
    const externalId: string = sendResult?.key?.id ?? sendResult?.id ?? `out-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const updatedConv = await upsertConversation({
      companyId: s.companyId,
      phone: s.phone,
      direction: "OUTBOUND",
      body: text,
      instanceId: s.instanceId,
    });

    await prisma.message.create({
      data: {
        externalId,
        body: text,
        direction: "OUTBOUND",
        phone: s.phone,
        instanceId: s.instanceId,
        companyId: s.companyId,
        conversationId: updatedConv.id,
        ack: 1,
        // Marca de origem: mensagem gerada pelo agente autônomo (a UI pode
        // usar pra exibir o badge 🤖 sem precisar de campo novo).
        rawPayload: { autoAgent: true, assistantId: s.assistantId } as any,
      },
    });
    return true;
  } catch (err) {
    console.error(`[AutoAgent] falha ao enviar texto phone=${s.phone}:`, err);
    return false;
  }
}

// ── Agendamento (action AGENDAR) ─────────────────────────────────────────────

const REMINDER_BEFORE_MIN = 60; // lembrete 1h antes da reunião

/**
 * Confirma a reunião escolhida: revalida o slot (NUNCA confirma horário
 * ocupado), cria o evento com Google Meet, manda a confirmação + link no
 * WhatsApp, agenda o lembrete e encaminha pro time comercial (rota createLead).
 */
async function handleBooking(args: {
  conversationId: string;
  companyId: string;
  phone: string;
  setorId: string | null;
  sender: BotSender;
  scheduling: SchedulingContext | null;
  decision: AgentDecision;
  routes: { intent: string; setorId: string; setorName: string; createLead: boolean }[];
}): Promise<void> {
  const { conversationId, companyId, phone, setorId, sender, scheduling, decision, routes } = args;

  // Sem contexto de agenda o modelo não deveria emitir AGENDAR — handoff defensivo.
  if (!scheduling) {
    console.warn(`[AutoAgent] AGENDAR sem scheduling ctx conv=${conversationId} — handoff`);
    await handoffConversation({ conversationId, setorId, resumo: decision.resumo, phone });
    return;
  }

  // O horário TEM que ser um dos oferecidos (anti-alucinação de slot).
  const slot = decision.agendarInicio
    ? scheduling.slots.find((sl) => sl.startISO === decision.agendarInicio) ?? null
    : null;
  if (!slot) {
    await sendBotText(sender, "Só me confirma qual dos horários que te passei fica melhor pra você? 😊");
    return;
  }

  // Revalidação de última hora — alguém pode ter ocupado a agenda no meio tempo.
  let free = false;
  try {
    free = await isSlotStillFree(scheduling.connectionId, slot.startISO, scheduling.durationMin);
  } catch (err) {
    console.error(`[AutoAgent] falha ao revalidar slot conv=${conversationId}:`, err);
  }
  if (!free) {
    let alt = "";
    try {
      const fresh = await computeAvailableSlots({
        companyId,
        connectionId: scheduling.connectionId,
        durationMin: scheduling.durationMin,
        maxSlots: 8,
      });
      const manha = fresh.find((sl) => sl.period === "manha");
      const tarde = fresh.find((sl) => sl.period === "tarde");
      const opts = [manha, tarde].filter(Boolean).map((sl) => sl!.label);
      if (opts.length) alt = ` Consigo ${opts.join(" ou ")} — algum desses te atende?`;
    } catch { /* sem alternativas, segue só o aviso */ }
    await sendBotText(sender, `Poxa, esse horário acabou de ser preenchido aqui 😅${alt}`);
    return;
  }

  // Nome do lead (se existir) pro título do evento.
  const lead = await prisma.lead.findFirst({
    where: { phone, companyId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });

  let booked;
  try {
    booked = await createMeetEvent({
      connectionId: scheduling.connectionId,
      startISO: slot.startISO,
      durationMin: scheduling.durationMin,
      summary: `Reunião — ${lead?.name ?? phone}`,
      description: [
        decision.resumo ? `Resumo da qualificação: ${decision.resumo}` : null,
        `Contato: ${phone}${decision.agendarEmail ? ` · ${decision.agendarEmail}` : ""}`,
        "Agendado pelo agente de IA (LeadHub).",
      ].filter(Boolean).join("\n"),
      attendeeEmail: decision.agendarEmail,
    });
  } catch (err) {
    console.error(`[AutoAgent] falha ao criar evento conv=${conversationId}:`, err);
    await sendBotText(sender, "Tive um probleminha pra confirmar aqui 😅 Vou pedir pro nosso time garantir seu horário, tá bom?");
    await handoffConversation({ conversationId, setorId, resumo: decision.resumo, phone });
    return;
  }

  // Confirmação no WhatsApp (2 bolhas) + lembrete agendado.
  await sendBotText(sender, `Prontinho! Reunião confirmada pra ${booked.label} 🎉`);
  await new Promise((r) => setTimeout(r, 1800));
  await sendBotText(
    sender,
    booked.meetLink
      ? `Aqui o link da nossa reunião no Google Meet: ${booked.meetLink}${decision.agendarEmail ? " — o convite também foi pro seu e-mail 😉" : ""}`
      : `O convite com o link da reunião foi pro seu e-mail 😉`
  );

  const reminderAt = new Date(booked.start.getTime() - REMINDER_BEFORE_MIN * 60_000);
  if (reminderAt.getTime() > Date.now() + 5 * 60_000) {
    const timePart = booked.label.slice(-5); // "HH:MM"
    await prisma.scheduledMessage.create({
      data: {
        companyId,
        instanceId: sender.instanceId,
        phone,
        sendAt: reminderAt,
        kind: "meeting_reminder",
        body: `Oi! Passando pra lembrar da nossa reunião daqui a pouco, às ${timePart} 🙌${booked.meetLink ? ` Link: ${booked.meetLink}` : ""}`,
        meta: { eventId: booked.eventId, conversationId, meetLink: booked.meetLink } as any,
      },
    }).catch((err) => console.error(`[AutoAgent] falha ao agendar lembrete conv=${conversationId}:`, err));
  }

  await prisma.conversationNote.create({
    data: {
      conversationId,
      authorName: "🤖 Agente IA",
      type: "SYSTEM",
      body: `Reunião agendada: ${booked.label}${decision.agendarEmail ? ` · convite pra ${decision.agendarEmail}` : ""}${booked.meetLink ? `\nMeet: ${booked.meetLink}` : ""}${decision.resumo ? `\nResumo: ${decision.resumo}` : ""}`,
    },
  }).catch(() => {/* acessório */});

  // Reunião marcada = lead quente → encaminha pro time comercial (rota com
  // createLead). Sem rota, só silencia o bot — humano assume dali.
  const commercialRoute = routes.find((r) => r.createLead) ?? null;
  const resumoComReuniao = `${decision.resumo ?? "Reunião agendada pelo agente."} | Reunião: ${booked.label}`;
  if (commercialRoute) {
    await routeConversation({
      conversationId,
      companyId,
      phone,
      setorId: commercialRoute.setorId,
      setorName: commercialRoute.setorName,
      createLead: true,
      resumo: resumoComReuniao,
    });
  } else {
    await pauseBot(conversationId);
  }
}

// ── Ações ─────────────────────────────────────────────────────────────────────

async function routeConversation(args: {
  conversationId: string;
  companyId: string;
  phone: string;
  setorId: string;
  setorName: string;
  createLead: boolean;
  resumo: string | null;
}): Promise<void> {
  const { conversationId, companyId, phone, setorId, setorName, createLead, resumo } = args;

  // Move pro setor, volta pra OPEN (aparece como "nova" pro time que assumiu)
  // e silencia o bot.
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      setorId,
      status: "OPEN",
      statusUpdatedAt: new Date(),
      aiMode: "PAUSED_HUMAN",
      aiPausedAt: new Date(),
    },
  });

  await prisma.conversationNote.create({
    data: {
      conversationId,
      authorName: "🤖 Agente IA",
      type: "SYSTEM",
      body: `Triagem automática → setor ${setorName}.${resumo ? `\nResumo: ${resumo}` : ""}`,
    },
  }).catch(() => {/* nota é acessório, nunca bloqueia */});

  // Lead no CRM (rota comercial)
  if (createLead) {
    try {
      let lead = await prisma.lead.findFirst({
        where: { phone, companyId },
        orderBy: { createdAt: "desc" },
      });
      if (!lead) {
        const firstStage = await prisma.pipelineStageConfig.findFirst({
          where: { companyId, pipeline: "LEADS" },
          orderBy: { order: "asc" },
        });
        lead = await prisma.lead.create({
          data: {
            phone,
            companyId,
            source: "ia-triagem",
            status: LeadStatus.NEW,
            pipeline: "LEADS",
            pipelineStage: firstStage?.name ?? null,
            conversationId,
          },
        });
      } else if (lead.conversationId !== conversationId) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { conversationId },
        }).catch(() => null);
      }
      if (resumo) {
        await prisma.activity.create({
          data: {
            type: "NOTE_ADDED",
            leadId: lead.id,
            companyId,
            authorName: "🤖 Agente IA",
            body: `Qualificação da triagem automática: ${resumo}`,
            meta: { kind: "auto_agent_qualification" },
          },
        }).catch(() => null);
      }
    } catch (err) {
      console.error(`[AutoAgent] falha ao criar lead conv=${conversationId}:`, err);
    }
  }

  await notifySetor(setorId, {
    title: `🤖 IA encaminhou um atendimento (${setorName})`,
    body: resumo ?? "Novo atendimento triado pela IA.",
    url: `/whatsapp?abrir=${encodeURIComponent(phone)}`,
    tag: `auto-agent-${conversationId}`,
  });
}

async function handoffConversation(args: {
  conversationId: string;
  setorId: string | null;
  resumo: string | null;
  phone: string;
}): Promise<void> {
  const { conversationId, setorId, resumo, phone } = args;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: "OPEN",
      statusUpdatedAt: new Date(),
      aiMode: "PAUSED_HUMAN",
      aiPausedAt: new Date(),
    },
  });

  await prisma.conversationNote.create({
    data: {
      conversationId,
      authorName: "🤖 Agente IA",
      type: "SYSTEM",
      body: `Passou pra atendimento humano.${resumo ? `\nResumo: ${resumo}` : ""}`,
    },
  }).catch(() => {/* acessório */});

  if (setorId) {
    await notifySetor(setorId, {
      title: "🤖 IA pediu atendimento humano",
      body: resumo ?? "Contato precisa de um atendente.",
      url: `/whatsapp?abrir=${encodeURIComponent(phone)}`,
      tag: `auto-agent-${conversationId}`,
    });
  }
}

async function notifySetor(
  setorId: string,
  payload: { title: string; body: string; url: string; tag: string }
): Promise<void> {
  try {
    const members = await prisma.setorUser.findMany({
      where: { setorId },
      select: { userId: true },
    });
    await Promise.all(
      members.map((m) => sendPushToUser(m.userId, payload, "newMessage"))
    );
  } catch {
    /* push é acessório — nunca propaga */
  }
}
