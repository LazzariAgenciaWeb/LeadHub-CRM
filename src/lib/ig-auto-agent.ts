import { prisma } from "./prisma";
import { runAssistant, getServicesCatalogBlock, type ChatMessage } from "./assistant";
import {
  decryptAccountToken,
  getUserFollowStatus,
  sendMessageToUser,
  recordIgMessage,
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

export const IG_AUTO_AGENT_REV = "v1-direct";

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
type AgentDecision = { reply: string[]; action: "NONE" | "HANDOFF" };

function parseDecision(raw: string): AgentDecision | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    const reply = Array.isArray(obj.reply)
      ? obj.reply.map((b: unknown) => String(b ?? "").trim()).filter(Boolean)
      : typeof obj.reply === "string" && obj.reply.trim()
        ? [obj.reply.trim()]
        : [];
    const action = obj.action === "HANDOFF" ? "HANDOFF" : "NONE";
    return { reply: reply.slice(0, 3), action };
  } catch {
    return null;
  }
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
  };

  if (!conv) return skip("conversa_inexistente");
  if (conv.channel !== "INSTAGRAM" || !conv.account) return skip("canal_nao_suportado");
  if (conv.aiMode !== "ACTIVE") return skip(`aiMode_${conv.aiMode}`);
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

  // Follow status (best-effort) — o manual da empresa decide o que fazer com isso.
  const follows = await getUserFollowStatus(conv.participantId, token);
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
    ? `\n\n# DADOS DO PROSPECT (levantados pela equipe — use para personalizar a conversa; NUNCA recite esta ficha de volta nem revele que existe)\n` +
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
  const scheduling = assistant.schedulingLink?.trim()
    ? `\n\nLink de agendamento (copie EXATAMENTE quando for convidar para reunião): ${assistant.schedulingLink.trim()}`
    : "";

  const system = [
    `Você atende o DIRECT DO INSTAGRAM de uma empresa. Estilo: mensagens curtas de chat (1 a 3 bolhas de no máximo ~2 frases), tom humano e natural, no idioma do contato.`,
    assistant.discloseAi
      ? "Você PODE se apresentar como assistente de IA, com leveza."
      : "Não afirme nem negue ser uma IA; simplesmente atenda bem.",
    `\n# MANUAL DA EMPRESA (sua diretriz principal)\n${assistant.manual}`,
    learnings,
    checklist,
    prospectBlock,
    catalog,
    scheduling,
    `\n# CONTEXTO\n- Contato: ${conv.participantUsername ? "@" + conv.participantUsername : "sem @ identificado"}.\n- ${followLine}\n- Mensagens do histórico marcadas [equipe] foram enviadas manualmente por um humano do time — use-as como contexto do que já foi dito.`,
    `\n# FORMATO DA RESPOSTA\nResponda SOMENTE com um JSON válido, sem texto fora dele:\n{"reply": ["bolha 1", "bolha 2 (opcional)"], "action": "NONE"}\n- "reply": 1 a 3 bolhas CURTAS; resposta simples = 1 bolha; UMA pergunta no máximo, na última bolha; no máximo 1 emoji no total.\n- "action": "NONE" para continuar conversando; "HANDOFF" quando o contato pedir atendimento humano ou você não souber ajudar (nesse caso "reply" avisa que alguém do time vai assumir).\n- Se não houver nada útil a dizer, responda {"reply": [], "action": "NONE"}.`,
  ]
    .filter(Boolean)
    .join("\n");

  const chat: ChatMessage[] = [{ role: "system", content: system }];
  for (const m of history) {
    if (!m.text?.trim()) continue;
    if (m.direction === "IN") chat.push({ role: "user", content: m.text });
    else {
      const prefix = m.source === "EXTERNAL" || m.source === "AGENT" ? "[equipe] " : "";
      chat.push({ role: "assistant", content: prefix + m.text });
    }
  }

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

  const decision = parseDecision(result.text) ?? { reply: [result.text.trim()].filter(Boolean).slice(0, 1), action: "NONE" as const };

  // Reconfere que ninguém respondeu enquanto a IA pensava.
  const fresh = await prisma.igConversation.findUnique({
    where: { id: conv.id },
    select: { lastDirection: true, aiMode: true },
  });
  if (!fresh || fresh.lastDirection !== "IN" || fresh.aiMode !== "ACTIVE") return skip("respondida_durante_ia");

  for (const bubble of decision.reply) {
    try {
      const mid = await sendMessageToUser(conv.participantId, bubble, token);
      await recordIgMessage({
        companyId: conv.companyId,
        channel: "INSTAGRAM",
        connectionId: conv.connectionId ?? conv.accountId ?? conv.participantId,
        accountId: conv.accountId,
        participantId: conv.participantId,
        direction: "OUT",
        source: "AI",
        text: bubble,
        mid,
      });
    } catch (e: any) {
      console.error(`[IgAgent] envio falhou conv=${conv.id}:`, e?.message);
      recordRun({ conv: conv.id, error: `envio: ${e?.message?.slice(0, 200)}` });
      return;
    }
    if (decision.reply.length > 1) await new Promise((r) => setTimeout(r, BUBBLE_DELAY_MS));
  }

  if (decision.action === "HANDOFF") {
    await prisma.igConversation.update({
      where: { id: conv.id },
      data: { aiMode: "PAUSED_HUMAN", needsReply: true },
    });
  }

  recordRun({ conv: conv.id, action: decision.action, bubbles: decision.reply.length, follows });
  console.log(`[IgAgent] conv=${conv.id} action=${decision.action} bolhas=${decision.reply.length}`);
}
