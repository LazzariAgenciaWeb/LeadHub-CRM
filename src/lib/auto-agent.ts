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
export const AUTO_AGENT_REV = "v13-chamado-por-rota";

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

// Palavra-gatilho default: contato digita SÓ isso numa conversa pausada
// (humano assumiu) → bot reativa. Configurável por agente (reactivationWord);
// OFF manual continua respeitado.
const REACTIVATION_WORD = "atendimento";

/** Normaliza pra comparar palavra-gatilho: minúsculas, sem acento/pontuação. */
function normalizeWord(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Sentinela de cortesia: conversa pausada + INBOUND sem resposta humana em
// N minutos → aviso educado (sem marcar a conversa como respondida).
// Delay e texto são CONFIGURÁVEIS por agente (courtesyDelayMin/courtesyText;
// 0 = desligada). Cooldown é fixo.
const COURTESY_COOLDOWN_MS = 60 * 60_000; // máx 1 aviso por conversa por hora
const COURTESY_DEFAULT_TEXT = "Recebemos sua mensagem! 😊 Já já alguém do nosso time te responde por aqui.";

// Debounce por conversa. Vive em globalThis pra sobreviver ao HMR do dev.
// Servidor único (standalone) — suficiente pra Fase 1; se um dia houver
// réplicas, trocar por fila (pg-boss).
const timers: Map<string, ReturnType<typeof setTimeout>> =
  (globalThis as any).__autoAgentTimers ?? new Map();
(globalThis as any).__autoAgentTimers = timers;

const courtesyTimers: Map<string, ReturnType<typeof setTimeout>> =
  (globalThis as any).__autoAgentCourtesyTimers ?? new Map();
(globalThis as any).__autoAgentCourtesyTimers = courtesyTimers;

/**
 * Agenda o processamento da conversa com debounce + a sentinela de cortesia.
 * Chamar a cada INBOUND (o webhook chama; é barato — os guards pesados rodam
 * só quando dispara).
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

  // Sentinela de cortesia — reinicia a contagem a cada mensagem nova. O delay
  // e o texto vêm da config do agente (lookup assíncrono); os guards (alguém
  // respondeu? cooldown?) rodam de novo na hora de disparar.
  const c = courtesyTimers.get(conversationId);
  if (c) clearTimeout(c);
  void (async () => {
    try {
      const cfg = await getCourtesyConfig(conversationId);
      if (!cfg) return;
      const prev = courtesyTimers.get(conversationId);
      if (prev) clearTimeout(prev);
      courtesyTimers.set(
        conversationId,
        setTimeout(() => {
          courtesyTimers.delete(conversationId);
          runCourtesyCheck(conversationId, cfg.text).catch((err) =>
            console.error(`[AutoAgent] erro cortesia conv=${conversationId}:`, err)
          );
        }, cfg.delayMs)
      );
    } catch { /* sentinela é acessório — nunca propaga */ }
  })();
}

/** Config da sentinela a partir do agente autônomo da instância (null = desligada). */
async function getCourtesyConfig(conversationId: string): Promise<{ delayMs: number; text: string } | null> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { isGroup: true, companyId: true },
  });
  if (!conv || conv.isGroup) return null;
  const last = await prisma.message.findFirst({
    where: { conversationId },
    orderBy: { receivedAt: "desc" },
    select: { instanceId: true },
  });
  if (!last?.instanceId) return null;
  const assistant = await getAssistantForInstance(conv.companyId, last.instanceId);
  if (!assistant || !assistant.isActive || !(assistant as any).autoRespond) return null;
  const delayMin = ((assistant as any).courtesyDelayMin as number) ?? 5;
  if (delayMin <= 0) return null;
  return {
    delayMs: delayMin * 60_000,
    text: ((assistant as any).courtesyText as string | null)?.trim() || COURTESY_DEFAULT_TEXT,
  };
}

/**
 * Aviso de cortesia: ninguém (humano nem bot) respondeu o INBOUND em N min
 * numa conversa de instância com agente autônomo → "recebemos sua mensagem".
 * NÃO altera status/unread da conversa — ela continua pendente pro time.
 */
async function runCourtesyCheck(conversationId: string, text: string = COURTESY_DEFAULT_TEXT): Promise<void> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, phone: true, isGroup: true, status: true, companyId: true, lastMessageDirection: true },
  });
  if (!conv || conv.isGroup || conv.status === "CLOSED") return;
  if (conv.lastMessageDirection !== "INBOUND") return; // alguém já respondeu

  const last = await prisma.message.findFirst({
    where: { conversationId },
    orderBy: { receivedAt: "desc" },
    select: { instanceId: true },
  });
  if (!last?.instanceId) return;

  // Só em instâncias com agente autônomo (não vira comportamento global).
  const assistant = await getAssistantForInstance(conv.companyId, last.instanceId);
  if (!assistant || !assistant.isActive || !(assistant as any).autoRespond) return;

  // Anti-spam: no máximo 1 cortesia por conversa por hora.
  const recentCourtesy = await prisma.message.findFirst({
    where: {
      conversationId,
      direction: "OUTBOUND",
      receivedAt: { gte: new Date(Date.now() - COURTESY_COOLDOWN_MS) },
      rawPayload: { path: ["courtesy"], equals: true },
    },
    select: { id: true },
  });
  if (recentCourtesy) return;

  const instance = await prisma.whatsappInstance.findUnique({
    where: { id: last.instanceId },
    select: { id: true, instanceName: true, instanceToken: true, phone: true },
  });
  if (!instance) return;

  // Placeholders {palavra}/{link} também valem no texto da sentinela.
  const word = ((assistant as any).reactivationWord as string | null)?.trim() || REACTIVATION_WORD;
  const waLink = (instance as any).phone
    ? `https://wa.me/${(instance as any).phone}?text=${encodeURIComponent(word)}`
    : null;
  const finalText = text.replace(/\{palavra\}/gi, word).replace(/\{link\}/gi, waLink ?? `*${word}*`);

  try {
    const res = await evolutionSendText(instance.instanceName, conv.phone, finalText, instance.instanceToken ?? null);
    const externalId: string = res?.key?.id ?? res?.id ?? `out-${Date.now()}-c`;
    // De propósito SEM upsertConversation: o status continua OPEN e o unread
    // continua contando — o time ainda precisa responder de verdade.
    await prisma.message.create({
      data: {
        externalId,
        body: finalText,
        direction: "OUTBOUND",
        phone: conv.phone,
        instanceId: instance.id,
        companyId: conv.companyId,
        conversationId,
        ack: 1,
        rawPayload: { autoAgent: true, courtesy: true } as any,
      },
    });
    recordRun({ conv: conversationId, courtesy: "enviada_apos_5min_sem_resposta" });
  } catch (err) {
    console.error(`[AutoAgent] falha ao enviar cortesia conv=${conversationId}:`, err);
  }
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
  // Cada slot ganha um código curto (S1, S2...) — o modelo devolve o código
  // no agendarInicio, muito mais confiável que copiar ISO/rótulo sem errar.
  const indexed = ctx.slots.map((s, i) => ({ s, code: `S${i + 1}` }));
  const manha = indexed.filter((x) => x.s.period === "manha").slice(0, 8);
  const tarde = indexed.filter((x) => x.s.period === "tarde").slice(0, 8);
  const fmt = (list: { s: Slot; code: string }[]) =>
    list.length ? list.map((x) => `[${x.code}] ${x.s.label}`).join(" | ") : "(nenhum)";

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
  "agendarInicio" = o CÓDIGO do horário escolhido (ex.: "S1")
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
  routes: { intent: string; label: string | null; setorName: string; createTicket?: boolean }[];
  scheduling: SchedulingContext | null;
  knownData: string[];
}): string {
  const { manual, learnings, schedulingLink, qualificationChecklist, servicesBlock, routes, scheduling, knownData } = args;

  const routeLines = routes
    .map((r) => `- "${r.intent}" → encaminha pro setor ${r.label ?? r.setorName}${r.createTicket ? " e ABRE UM CHAMADO interno com o pedido (avise o contato que o chamado foi registrado)" : ""}. Use quando o contato foi identificado/qualificado como esse caso.`)
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
- O que está em DADOS JÁ CADASTRADOS (se houver) também conta como coletado — apenas confirme.
- Só ofereça agendar reunião/horário depois que TODAS estiverem coletadas.
- Inclua todas as respostas coletadas no campo "resumo" ao encaminhar.`);
  }

  if (knownData.length) {
    parts.push(`# DADOS JÁ CADASTRADOS DO CONTATO (do sistema — NÃO pergunte de novo; apenas CONFIRME com naturalidade quando for usar)
${knownData.join("\n")}
Ex.: em vez de pedir o e-mail de novo, confirme ("posso mandar o convite naquele seu e-mail que termina em ...?"). Se o contato corrigir algum dado, use o valor novo.`);
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
${scheduling ? `Ao CONFIRMAR reunião, o JSON tem MAIS DOIS CAMPOS OBRIGATÓRIOS (sem eles o agendamento não acontece):
{"reply": [], "action": "AGENDAR", "agendarInicio": "S1", "agendarEmail": "cliente@email.com", "resumo": "..."}
` : ""}- "reply": lista de 1 a 3 mensagens curtas (enviadas em sequência, como bolhas separadas). Pode ser string única. null/[] se não deve responder nada.
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
      companyId: true, setorId: true, assigneeId: true, aiCycleResetAt: true,
    },
  });

  if (!conv) return { ok: false, skipped: "conv_not_found" };
  if (conv.isGroup) return { ok: false, skipped: "group" };
  if (conv.status === "CLOSED") return { ok: false, skipped: "closed" };

  // Última mensagem precisa ser INBOUND — se humano (ou o próprio bot) já
  // respondeu depois dela, não há o que fazer.
  const last = await prisma.message.findFirst({
    where: { conversationId: conv.id },
    orderBy: { receivedAt: "desc" },
    select: { id: true, direction: true, instanceId: true, receivedAt: true, body: true },
  });
  if (!last || last.direction !== "INBOUND") return { ok: false, skipped: "last_not_inbound" };
  if (!last.instanceId) return { ok: false, skipped: "no_instance" };

  const instance = await prisma.whatsappInstance.findUnique({
    where: { id: last.instanceId },
    select: { id: true, instanceName: true, instanceToken: true, status: true, phone: true },
  });
  if (!instance) return { ok: false, skipped: "instance_not_found" };

  // Agente autônomo da instância (independe do type — roteamento por número)
  const assistant = await getAssistantForInstance(conv.companyId, instance.id);
  if (!assistant || !assistant.isActive || !(assistant as any).autoRespond) {
    return { ok: false, skipped: "no_auto_assistant" };
  }

  // Estado do bot: OFF manual é sagrado; PAUSED_HUMAN aceita a palavra-gatilho
  // configurada no agente (default "atendimento") pro contato reativar sozinho.
  if (conv.aiMode === "OFF") return { ok: false, skipped: "aiMode_OFF" };
  if (conv.aiMode === "PAUSED_HUMAN") {
    const word = normalizeWord(((assistant as any).reactivationWord as string | null) ?? "") || REACTIVATION_WORD;
    if (normalizeWord(last.body ?? "") !== word) {
      return { ok: false, skipped: "aiMode_PAUSED_HUMAN" };
    }
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { aiMode: "ACTIVE", aiPausedAt: null },
    });
    diag.reativado = "palavra_gatilho";
  }

  const routes = await prisma.assistantRoute.findMany({
    where: { assistantId: assistant.id },
    include: { setor: { select: { id: true, name: true } } },
  });

  // Histórico recente (ordem cronológica). aiCycleResetAt = "atendimento
  // concluído": tudo antes do marco é invisível pro agente — ciclo novo.
  const history = await prisma.message.findMany({
    where: {
      conversationId: conv.id,
      ...(conv.aiCycleResetAt ? { receivedAt: { gt: conv.aiCycleResetAt } } : {}),
    },
    orderBy: { receivedAt: "desc" },
    take: HISTORY_LIMIT,
    select: { body: true, direction: true, receivedAt: true },
  });
  history.reverse();

  // Dados já cadastrados (Lead/Contato) — o agente CONFIRMA em vez de pedir.
  const [leadInfo, contactInfo] = await Promise.all([
    prisma.lead.findFirst({
      where: { phone: conv.phone, companyId: conv.companyId },
      orderBy: { createdAt: "desc" },
      select: { name: true, email: true, website: true, instagram: true },
    }),
    prisma.companyContact.findFirst({
      where: { phone: conv.phone, companyId: conv.companyId },
      select: { name: true },
    }),
  ]);
  const knownData = [
    (leadInfo?.name || contactInfo?.name) ? `- Nome: ${leadInfo?.name ?? contactInfo?.name}` : null,
    leadInfo?.email ? `- E-mail: ${leadInfo.email}` : null,
    leadInfo?.instagram ? `- Instagram: ${leadInfo.instagram}` : null,
    leadInfo?.website ? `- Site: ${leadInfo.website}` : null,
  ].filter((l): l is string => l !== null);

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
    routes: routes.map((r) => ({ intent: r.intent, label: r.label, setorName: r.setor.name, createTicket: r.createTicket })),
    scheduling,
    knownData,
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
      content: `LEMBRETE FINAL (obrigatório): responda SOMENTE o JSON. "reply" = 1 a 3 bolhas CURTAS (máx ~2 frases / ${MAX_BUBBLE_CHARS} caracteres cada) — NUNCA um parágrafo único longo, mesmo que as mensagens antigas do histórico sejam longas. VARIE: resposta simples = 1 bolha só; não feche sempre em 3. No máximo 1 emoji na resposta inteira (varie o emoji; quase sempre nenhum). UMA pergunta só, na última bolha. Não use o nome do contato se já usou nas últimas mensagens. NUNCA repita convite/link que o contato já recusou ou ignorou.${scheduling ? ` ATENÇÃO: você TEM a seção AGENDAMENTO DIRETO com horários livres da agenda — ofereça horários DELA; NUNCA diga que um gestor vai verificar disponibilidade e NUNCA envie link de agenda. Ao confirmar reunião use action "AGENDAR" COM os campos "agendarInicio" (código [S...] do horário) e "agendarEmail" dentro do JSON.` : ""}`,
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
  if (decision.agendarInicio) diag.agendarInicio = decision.agendarInicio;

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
    // Resgate: se o modelo esquecer os campos do JSON, o motor resolve o slot
    // pelo TEXTO da última mensagem do contato ("seg 03/08 09:00", "3/8 as 9")
    // e o e-mail por regex no histórico recente.
    const inboundDesc = [...history].reverse().filter((m) => m.direction === "INBOUND");
    const fallbackText = inboundDesc[0]?.body ?? null;
    const fallbackEmail = inboundDesc
      .map((m) => m.body.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0] ?? null)
      .find(Boolean) ?? null;

    await handleBooking({
      conversationId: conv.id,
      companyId: conv.companyId,
      phone: conv.phone,
      setorId: conv.setorId,
      sender: botSender,
      scheduling,
      decision,
      fallbackText,
      fallbackEmail,
      diag,
      routes: routes.map((r) => ({ intent: r.intent, setorId: r.setorId, setorName: r.setor.name, createLead: r.createLead, createTicket: r.createTicket })),
    });
    return { ok: true, action, replied: true };
  }
  if (action !== "NONE") {
    // Aviso de pausa (configurável) — a despedida do bot ensina o gatilho de
    // reativação, com link wa.me que preenche a palavra sozinho (contato só
    // toca e envia). Enviado ANTES de rotear: o roteamento seta a conversa
    // como OPEN pro time, e um envio depois viraria WAITING_CUSTOMER (sumiria
    // da fila de pendentes).
    if ((assistant as any).sendPauseNotice !== false) {
      const word = ((assistant as any).reactivationWord as string | null)?.trim() || REACTIVATION_WORD;
      const waLink = (instance as any).phone
        ? `https://wa.me/${(instance as any).phone}?text=${encodeURIComponent(word)}`
        : null;
      const custom = ((assistant as any).pauseNoticeText as string | null)?.trim();
      const notice = custom
        ? custom.replace(/\{palavra\}/gi, word).replace(/\{link\}/gi, waLink ?? `*${word}*`)
        : `Agradecemos o contato! 🙏 Se precisar do atendimento automático de novo, é só digitar *${word}*${waLink ? ` — ou toque aqui que já vai pronto: ${waLink}` : ""}.`;
      await new Promise((r) => setTimeout(r, 1500));
      await sendBotText(botSender, notice);
    }

    const route = routes.find((r) => r.intent.toUpperCase() === action) ?? null;

    if (route) {
      await routeConversation({
        conversationId: conv.id,
        companyId: conv.companyId,
        phone: conv.phone,
        setorId: route.setorId,
        setorName: route.setor.name,
        createLead: route.createLead,
        createTicket: route.createTicket,
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
 * Resolve o slot escolhido pelo modelo. Aceita, nesta ordem:
 *  1. Código "S<n>" (formato pedido no prompt — o mais confiável)
 *  2. Rótulo do slot ("seg 03/08 09:00"), com normalização de espaços/caixa
 *  3. dd/mm + hora em qualquer texto ("03/08 às 9h", "3/8 09:00")
 *  4. ISO em variações (sem segundos, sem offset, com espaço)
 * Sempre valida contra a lista oferecida — horário inventado continua barrado.
 */
function resolveSlot(slots: Slot[], agendarInicio: string | null): Slot | null {
  if (!agendarInicio) return null;
  const rawInput = agendarInicio.trim();

  // 1) Código S<n>
  const tok = rawInput.match(/^\[?S(\d{1,2})\]?$/i);
  if (tok) return slots[parseInt(tok[1], 10) - 1] ?? null;

  // 2) Rótulo
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
  const rn = norm(rawInput);
  const byLabel = slots.find((s) => norm(s.label) === rn || (rn.length >= 8 && rn.includes(norm(s.label))));
  if (byLabel) return byLabel;

  // 3) dd/mm + hora (ano e offset herdados dos próprios slots)
  const offset = slots[0]?.startISO.match(/([+-]\d{2}:\d{2})$/)?.[1];
  const year = slots[0]?.startISO.slice(0, 4);
  const dm = rn.match(/(\d{1,2})\/(\d{1,2})\D*?(\d{1,2})(?::(\d{2})|h)?/);
  if (dm && offset && year) {
    const [, dd, mm, hh, min] = dm;
    const iso = `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T${hh.padStart(2, "0")}:${(min ?? "00").padStart(2, "0")}:00${offset}`;
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) {
      const match = slots.find((s) => Date.parse(s.startISO) === t);
      if (match) return match;
    }
  }

  // 4) ISO com variações
  const raw = rawInput.replace(" ", "T");
  const candidates = [raw];
  if (!/(?:[+-]\d{2}:?\d{2}|Z)$/i.test(raw) && offset) {
    candidates.push(`${raw}${offset}`);
    if (/T\d{2}:\d{2}$/.test(raw)) candidates.push(`${raw}:00${offset}`);
  }
  for (const c of candidates) {
    const t = Date.parse(c);
    if (Number.isNaN(t)) continue;
    const match = slots.find((s) => Date.parse(s.startISO) === t);
    if (match) return match;
  }
  return null;
}

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
  fallbackText: string | null;
  fallbackEmail: string | null;
  diag: Record<string, unknown>;
  routes: { intent: string; setorId: string; setorName: string; createLead: boolean }[];
}): Promise<void> {
  const { conversationId, companyId, phone, setorId, sender, scheduling, decision, fallbackText, fallbackEmail, diag, routes } = args;

  // Sem contexto de agenda o modelo não deveria emitir AGENDAR — handoff defensivo.
  if (!scheduling) {
    console.warn(`[AutoAgent] AGENDAR sem scheduling ctx conv=${conversationId} — handoff`);
    await handoffConversation({ conversationId, setorId, resumo: decision.resumo, phone });
    return;
  }

  // O horário TEM que ser um dos oferecidos (anti-alucinação de slot). Ordem:
  // o que o modelo devolveu no JSON; se ele esqueceu/errou o campo, o TEXTO
  // da última mensagem do contato ("seg 03/08 09:00", "3/8 as 9").
  const slot = resolveSlot(scheduling.slots, decision.agendarInicio) ?? resolveSlot(scheduling.slots, fallbackText);
  diag.booking = slot
    ? `slot_ok:${slot.label}`
    : `slot_nao_resolvido(model=${JSON.stringify(decision.agendarInicio)}, texto=${JSON.stringify(fallbackText?.slice(0, 40) ?? null)})`;
  if (!slot) {
    console.warn(`[AutoAgent] AGENDAR com horário não reconhecido conv=${conversationId}: "${decision.agendarInicio}" / texto="${fallbackText}"`);
    const manha = scheduling.slots.find((sl) => sl.period === "manha");
    const tarde = scheduling.slots.find((sl) => sl.period === "tarde");
    const opts = [manha, tarde].filter(Boolean).map((sl) => sl!.label);
    await sendBotText(
      sender,
      opts.length
        ? `Deixa eu confirmar direito o horário: consigo ${opts.join(" ou ")}. Qual desses fecha pra você?`
        : "Deixa eu confirmar direito: qual dia e horário você prefere?"
    );
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
    diag.booking = `ocupado:${slot.label}`;
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

  // Nome/e-mail do lead (se existir) — título do evento + e-mail de reserva.
  const lead = await prisma.lead.findFirst({
    where: { phone, companyId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, email: true },
  });

  // E-mail: o que veio no JSON; senão o que o contato digitou no histórico;
  // senão o cadastrado no Lead.
  const attendeeEmail = decision.agendarEmail ?? fallbackEmail ?? lead?.email ?? null;

  let booked;
  try {
    booked = await createMeetEvent({
      connectionId: scheduling.connectionId,
      startISO: slot.startISO,
      durationMin: scheduling.durationMin,
      summary: `Reunião — ${lead?.name ?? phone}`,
      description: [
        decision.resumo ? `Resumo da qualificação: ${decision.resumo}` : null,
        `Contato: ${phone}${attendeeEmail ? ` · ${attendeeEmail}` : ""}`,
        "Agendado pelo agente de IA (LeadHub).",
      ].filter(Boolean).join("\n"),
      attendeeEmail,
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
      ? `Aqui o link da nossa reunião no Google Meet: ${booked.meetLink}${attendeeEmail ? " — o convite também foi pro seu e-mail 😉" : ""}`
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
      body: `Reunião agendada: ${booked.label}${attendeeEmail ? ` · convite pra ${attendeeEmail}` : ""}${booked.meetLink ? `\nMeet: ${booked.meetLink}` : ""}${decision.resumo ? `\nResumo: ${decision.resumo}` : ""}`,
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
  createTicket?: boolean;
  resumo: string | null;
}): Promise<void> {
  const { conversationId, companyId, phone, setorId, setorName, createLead, createTicket, resumo } = args;

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

  // Chamado (Ticket) no setor — o pedido entra na fila do time com o resumo
  // já coletado pela IA. Prazo default: 24h.
  if (createTicket) {
    try {
      const contactName = await prisma.companyContact.findFirst({
        where: { companyId, phone },
        select: { name: true },
      });
      const shortTitle = (resumo ?? "Atendimento via IA").slice(0, 90);
      const ticket = await prisma.ticket.create({
        data: {
          title: `🤖 ${shortTitle}`,
          description: [
            resumo ? `Pedido coletado pela IA: ${resumo}` : "Pedido encaminhado pela IA (sem resumo).",
            `Contato: ${contactName?.name ?? "—"} · WhatsApp ${phone}`,
            `Conversa: /whatsapp?abrir=${encodeURIComponent(phone)}`,
          ].join("\n"),
          category: "ia-triagem",
          phone,
          companyId,
          setorId,
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      await prisma.conversationNote.create({
        data: {
          conversationId,
          authorName: "🤖 Agente IA",
          type: "SYSTEM",
          body: `Chamado aberto no setor ${setorName}: "${shortTitle}"`,
        },
      }).catch(() => {/* acessório */});
      console.log(`[AutoAgent] chamado ${ticket.id} aberto (conv=${conversationId}, setor=${setorName})`);
    } catch (err) {
      console.error(`[AutoAgent] falha ao abrir chamado conv=${conversationId}:`, err);
    }
  }

  await notifySetor(setorId, {
    title: createTicket
      ? `🤖 IA abriu um chamado (${setorName})`
      : `🤖 IA encaminhou um atendimento (${setorName})`,
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
