import { prisma } from "./prisma";
import { runAssistant } from "./assistant";
import { applyLeadUpdate } from "./leads/update-lead";
import { formatBrazilDateTime } from "./datetime";

/**
 * IA que lê a conversa do WhatsApp de um lead/oportunidade e sugere a etapa do
 * funil (e um retorno, quando a conversa combinou data: "me liga quinta 10h").
 *
 * Modos por empresa (Setting `crm_ai_stage:{companyId}`):
 *   off     → nada automático (o botão "Analisar com IA" no lead ainda funciona)
 *   suggest → a varredura analisa e deixa a SUGESTÃO no lead (aplicar/ignorar)
 *   auto    → a varredura APLICA quando é seguro (ver canAutoApply); o resto
 *             fica como sugestão
 *
 * Cada análise consome 1 interação da cota de IA da empresa (runAssistant).
 */

export type CrmAiStageMode = "off" | "suggest" | "auto";
export const CRM_AI_STAGE_KEY = (companyId: string) => `crm_ai_stage:${companyId}`;

/** Confiança mínima pra aplicar sozinho no modo auto. */
const AUTO_MIN_CONFIDENCE = 80;
/** Conversa precisa estar quieta há X min antes da varredura analisar (evita analisar no meio do papo). */
const QUIET_MS = 3 * 60_000;
/** Só olha conversas com movimento nos últimos N dias. */
const WINDOW_DAYS = 7;
/** Teto por rodada da varredura (controle de custo). */
const MAX_PER_SWEEP = 15;
const MAX_MESSAGES = 40;

export async function getCrmAiStageMode(companyId: string): Promise<CrmAiStageMode> {
  const row = await prisma.setting.findUnique({ where: { key: CRM_AI_STAGE_KEY(companyId) }, select: { value: true } });
  const v = row?.value?.trim();
  return v === "suggest" || v === "auto" ? v : "off";
}

interface StageInfo { name: string; order: number; isFinal: boolean; outcome: string }

export interface StageAnalysis {
  ok: boolean;
  error?: string;
  stage?: string | null;
  confidence?: number;
  reason?: string;
  returnAt?: Date | null;
  applied?: boolean;
}

/** Telefones cujas mensagens pertencem ao lead: o dele + o da conversa vinculada (ex.: grupo). */
async function leadPhones(lead: { phone: string; conversationId: string | null }) {
  const conv = lead.conversationId
    ? await prisma.conversation.findUnique({ where: { id: lead.conversationId }, select: { phone: true } })
    : null;
  return [...new Set([lead.phone, conv?.phone].filter((p): p is string => !!p?.trim()))];
}

function parseJson(text: string): any | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * Analisa um lead e grava a sugestão. Com `allowAuto`, aplica sozinho quando
 * canAutoApply permitir. Nunca lança.
 */
export async function analyzeLeadStage(
  leadId: string,
  opts: { allowAuto?: boolean; userId?: string | null } = {},
): Promise<StageAnalysis> {
  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return { ok: false, error: "Lead não encontrado" };
    if (!lead.pipeline) return { ok: false, error: "Lead fora de um funil" };

    const stages: StageInfo[] = await prisma.pipelineStageConfig.findMany({
      where: { companyId: lead.companyId, pipeline: lead.pipeline },
      orderBy: { order: "asc" },
      select: { name: true, order: true, isFinal: true, outcome: true },
    });
    if (stages.length === 0) return { ok: false, error: "Funil sem etapas configuradas" };

    const phones = await leadPhones(lead);
    if (phones.length === 0) return { ok: false, error: "Lead sem conversa de WhatsApp vinculada" };

    const msgs = await prisma.message.findMany({
      where: { companyId: lead.companyId, phone: { in: phones } },
      orderBy: { receivedAt: "desc" },
      take: MAX_MESSAGES,
      select: { body: true, direction: true, receivedAt: true, participantName: true, sentByAI: true, mediaType: true },
    });
    if (msgs.length === 0) return { ok: false, error: "Nenhuma mensagem nessa conversa" };
    msgs.reverse();

    const transcript = msgs.map((m) => {
      const who = m.direction === "INBOUND"
        ? (m.participantName ? `Cliente (${m.participantName})` : "Cliente")
        : (m.sentByAI ? "Nós (IA)" : "Nós");
      const body = m.body?.trim() || (m.mediaType ? `[${m.mediaType.split("/")[0]}]` : "[mídia]");
      return `[${formatBrazilDateTime(m.receivedAt)}] ${who}: ${body.slice(0, 500)}`;
    }).join("\n");

    const stageList = stages
      .map((s, i) => `${i + 1}. ${s.name}${s.outcome === "GANHO" ? " (venda fechada)" : s.outcome === "PERDIDO" ? " (perdido)" : s.isFinal ? " (encerramento)" : ""}`)
      .join("\n");

    const system = [
      "Você classifica negociações de um CRM a partir da conversa de WhatsApp.",
      "Escolha a etapa do funil que MELHOR descreve a situação ATUAL da negociação, usando só os nomes da lista.",
      "Considere sinais como: cliente respondeu/engajou, pediu orçamento ou proposta, pediu ou marcou reunião/visita/agendamento, confirmou horário, aceitou/fechou, recusou ou sumiu.",
      "Seja conservador: se a conversa não traz evidência clara de mudança, repita a etapa atual.",
      "Só escolha etapa de venda fechada se o cliente aceitou/pagou de forma explícita; só escolha perdido se ele recusou de forma explícita.",
      "Se a conversa combinou uma data/hora pra retomar contato ou reunião, informe em 'retorno' (ISO 8601 com fuso -03:00); senão null.",
      'Responda SOMENTE com JSON: {"etapa": "<nome exato>", "confianca": <0-100>, "motivo": "<1 frase em português citando a evidência>", "retorno": "<ISO ou null>"}',
    ].join("\n");

    const user = [
      `Agora: ${formatBrazilDateTime(new Date())} (horário de Brasília).`,
      `Funil: ${lead.pipeline}. Etapa atual: ${lead.pipelineStage ?? "(nenhuma)"}.`,
      `Etapas, em ordem:\n${stageList}`,
      `Conversa (mais antiga → mais recente):\n${transcript}`,
    ].join("\n\n");

    const res = await runAssistant({
      companyId: lead.companyId,
      endpoint: "crm-stage",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.1,
      maxTokens: 300,
      userId: opts.userId ?? null,
    });
    if (!res.ok) return { ok: false, error: res.error };

    const json = parseJson(res.text);
    const stageName = typeof json?.etapa === "string" ? json.etapa.trim() : "";
    const stage = stages.find((s) => s.name.toLowerCase() === stageName.toLowerCase()) ?? null;
    const confidence = Math.max(0, Math.min(100, Math.round(Number(json?.confianca) || 0)));
    const reason = typeof json?.motivo === "string" ? json.motivo.trim().slice(0, 400) : "";
    let returnAt: Date | null = null;
    if (typeof json?.retorno === "string" && json.retorno !== "null") {
      const d = new Date(json.retorno);
      if (!isNaN(d.getTime()) && d.getTime() > Date.now()) returnAt = d;
    }

    const sameStage = !stage || stage.name === lead.pipelineStage;
    // Retorno só vale como sugestão se é diferente do que já está agendado.
    const newReturn = returnAt && (!lead.expectedReturnAt || Math.abs(lead.expectedReturnAt.getTime() - returnAt.getTime()) > 30 * 60_000)
      ? returnAt : null;

    const analyzedAt = new Date();
    if (sameStage && !newReturn) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { aiStageSuggestion: null, aiStageReason: reason || null, aiStageConfidence: confidence, aiStageReturnAt: null, aiStageAnalyzedAt: analyzedAt },
      });
      return { ok: true, stage: null, confidence, reason, returnAt: null, applied: false };
    }

    const suggestion = sameStage ? null : stage!.name;

    if (opts.allowAuto && canAutoApply(lead.pipelineStage, stage, stages, confidence)) {
      await applyLeadUpdate(
        lead,
        { ...(suggestion ? { pipelineStage: suggestion } : {}), ...(newReturn ? { expectedReturnAt: newReturn } : {}) },
        { name: "IA (conversa do WhatsApp)" },
      );
      await prisma.lead.update({
        where: { id: lead.id },
        data: { aiStageSuggestion: null, aiStageReason: reason || null, aiStageConfidence: confidence, aiStageReturnAt: null, aiStageAnalyzedAt: analyzedAt },
      });
      await logReason(lead.companyId, lead.id, `IA moveu automaticamente${suggestion ? ` para "${suggestion}"` : ""}${newReturn ? ` e agendou retorno para ${formatBrazilDateTime(newReturn)}` : ""} (${confidence}%): ${reason}`);
      return { ok: true, stage: suggestion, confidence, reason, returnAt: newReturn, applied: true };
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        aiStageSuggestion: suggestion,
        aiStageReason: reason || null,
        aiStageConfidence: confidence,
        aiStageReturnAt: newReturn,
        aiStageAnalyzedAt: analyzedAt,
      },
    });
    return { ok: true, stage: suggestion, confidence, reason, returnAt: newReturn, applied: false };
  } catch (err: any) {
    console.error("[lead-stage-ai] erro", leadId, err);
    return { ok: false, error: err?.message ?? "Erro na análise" };
  }
}

/**
 * Regra do modo automático: confiança alta, só PRA FRENTE no funil e nunca
 * pra etapa de encerramento (ganho/perdido) — essas ficam como sugestão pro
 * atendente confirmar. Mudança só de retorno (mesma etapa) também aplica.
 */
function canAutoApply(current: string | null, target: StageInfo | null, stages: StageInfo[], confidence: number) {
  if (confidence < AUTO_MIN_CONFIDENCE) return false;
  if (!target || target.name === current) return true; // só o retorno mudou
  if (target.isFinal || target.outcome !== "NEUTRO") return false;
  const cur = stages.find((s) => s.name === current);
  return !cur || target.order > cur.order;
}

async function logReason(companyId: string, leadId: string, body: string) {
  await prisma.activity.create({
    data: { type: "NOTE_ADDED", leadId, companyId, authorName: "IA (conversa do WhatsApp)", body },
  }).catch(() => null);
}

/** Aplica a sugestão pendente (botão "Aplicar" no lead). */
export async function applyStageSuggestion(leadId: string, actor: { id?: string; name?: string | null }) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { ok: false as const, error: "Lead não encontrado" };
  if (!lead.aiStageSuggestion && !lead.aiStageReturnAt) return { ok: false as const, error: "Nenhuma sugestão pendente" };

  const updated = await applyLeadUpdate(
    lead,
    {
      ...(lead.aiStageSuggestion ? { pipelineStage: lead.aiStageSuggestion } : {}),
      ...(lead.aiStageReturnAt ? { expectedReturnAt: lead.aiStageReturnAt } : {}),
    },
    actor,
  );
  await prisma.lead.update({ where: { id: leadId }, data: { aiStageSuggestion: null, aiStageReturnAt: null } });
  return { ok: true as const, lead: updated };
}

export async function dismissStageSuggestion(leadId: string) {
  await prisma.lead.update({ where: { id: leadId }, data: { aiStageSuggestion: null, aiStageReturnAt: null } });
}

/**
 * Varredura (cron): para empresas com modo suggest/auto, analisa leads de
 * LEADS/OPORTUNIDADES cuja conversa teve mensagem nova desde a última análise
 * e está quieta há QUIET_MS. Não reanalisa sem conversa nova — custo controlado.
 */
export async function runCrmAiStageSweep(): Promise<{ companies: number; analyzed: number; suggested: number; applied: number }> {
  const modes = await prisma.setting.findMany({
    where: { key: { startsWith: "crm_ai_stage:" }, value: { in: ["suggest", "auto"] } },
    select: { key: true, value: true },
  });
  let analyzed = 0, suggested = 0, applied = 0;
  const now = Date.now();
  const since = new Date(now - WINDOW_DAYS * 86_400_000);
  const quietBefore = new Date(now - QUIET_MS);

  for (const row of modes) {
    if (analyzed >= MAX_PER_SWEEP) break;
    const companyId = row.key.slice("crm_ai_stage:".length);
    const auto = row.value === "auto";

    const convs = await prisma.conversation.findMany({
      where: { companyId, lastMessageAt: { gte: since, lte: quietBefore } },
      select: { id: true, phone: true, lastMessageAt: true },
      orderBy: { lastMessageAt: "desc" },
      take: 200,
    });
    if (convs.length === 0) continue;

    const leads = await prisma.lead.findMany({
      where: {
        companyId,
        pipeline: { in: ["LEADS", "OPORTUNIDADES"] },
        status: { notIn: ["CLOSED", "LOST"] },
        OR: [
          { conversationId: { in: convs.map((c) => c.id) } },
          { phone: { in: convs.map((c) => c.phone).filter(Boolean) } },
        ],
      },
      select: { id: true, phone: true, conversationId: true, aiStageAnalyzedAt: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    });

    const convById = new Map(convs.map((c) => [c.id, c]));
    const convByPhone = new Map(convs.map((c) => [c.phone, c]));
    const seen = new Set<string>();
    for (const l of leads) {
      if (analyzed >= MAX_PER_SWEEP) break;
      const conv = (l.conversationId && convById.get(l.conversationId)) || convByPhone.get(l.phone);
      if (!conv?.lastMessageAt || seen.has(conv.id)) continue;
      seen.add(conv.id); // um lead por conversa (o mais recente)
      if (l.aiStageAnalyzedAt && l.aiStageAnalyzedAt >= conv.lastMessageAt) continue;

      const r = await analyzeLeadStage(l.id, { allowAuto: auto });
      analyzed++;
      if (r.ok && r.applied) applied++;
      else if (r.ok && (r.stage || r.returnAt)) suggested++;
      if (!r.ok && /cota|créditos|OpenAI não configurada/i.test(r.error ?? "")) break; // empresa sem IA: pula o resto dela
    }
  }
  return { companies: modes.length, analyzed, suggested, applied };
}
