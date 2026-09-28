import { prisma } from "./prisma";

/**
 * Custo estimado de IA a partir do AiUsageLog (tokens reais por chamada).
 * Saldo da conta não existe por API (nem OpenAI nem Anthropic) — o que dá
 * pra mostrar é o GASTO, por período e por modelo. Preços de referência em
 * USD por 1M tokens (entrada / saída); modelo fora da tabela conta como 0 e
 * aparece marcado como "sem preço".
 */
const PRICES: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-opus-5":     { input: 5,    output: 25 },
  "claude-opus-4-8":   { input: 5,    output: 25 },
  "claude-opus-4-7":   { input: 5,    output: 25 },
  "claude-opus-4-6":   { input: 5,    output: 25 },
  "claude-sonnet-5":   { input: 2,    output: 10 },
  "claude-sonnet-4-6": { input: 3,    output: 15 },
  "claude-haiku-4-5":  { input: 1,    output: 5 },
  // OpenAI
  "gpt-4o-mini":       { input: 0.15, output: 0.60 },
  "gpt-4o":            { input: 2.5,  output: 10 },
  "gpt-4.1":           { input: 2,    output: 8 },
  "gpt-4.1-mini":      { input: 0.4,  output: 1.6 },
  "gpt-4.1-nano":      { input: 0.1,  output: 0.4 },
  "gpt-5":             { input: 1.25, output: 10 },
  "gpt-5-mini":        { input: 0.25, output: 2 },
  "gpt-5-nano":        { input: 0.05, output: 0.4 },
};

export function priceFor(model: string): { input: number; output: number } | null {
  const m = model.trim().toLowerCase();
  if (PRICES[m]) return PRICES[m];
  // Ex.: "gpt-4o-mini-2024-07-18" → "gpt-4o-mini"; "claude-sonnet-5-20260101" → "claude-sonnet-5"
  const base = Object.keys(PRICES).sort((a, b) => b.length - a.length).find((k) => m.startsWith(k));
  return base ? PRICES[base] : null;
}

export function estimateCostUSD(model: string, tokensIn: number, tokensOut: number): number | null {
  const p = priceFor(model);
  if (!p) return null;
  return (tokensIn / 1_000_000) * p.input + (tokensOut / 1_000_000) * p.output;
}

import type { AiSpend, AiSpendRow } from "./ai-costs-format";
export type { AiSpend, AiSpendRow } from "./ai-costs-format";
export { fmtUSD } from "./ai-costs-format";

const TZ = process.env.SYSTEM_TIMEZONE || "America/Sao_Paulo";
function startOfDayTZ(d: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  // meia-noite local → UTC via offset do próprio dia
  const local = new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00`);
  const offsetMin = (new Date(local.toLocaleString("en-US", { timeZone: TZ })).getTime() - local.getTime()) / 60000;
  return new Date(local.getTime() - offsetMin * 60000);
}

/** Gasto de IA da empresa (ou global, quando companyId é null — SUPER_ADMIN). */
export async function getAiSpend(companyId: string | null, opts?: { endpointPrefix?: string }): Promise<AiSpend> {
  const now = new Date();
  const today = startOfDayTZ(now);
  const week = new Date(today); week.setDate(week.getDate() - 6);
  const monthStart = new Date(today); monthStart.setDate(1);

  const rows = await prisma.aiUsageLog.findMany({
    where: {
      ...(companyId ? { companyId } : {}),
      ...(opts?.endpointPrefix ? { endpoint: { startsWith: opts.endpointPrefix } } : {}),
      createdAt: { gte: monthStart < week ? monthStart : week },
    },
    select: { model: true, tokensPrompt: true, tokensCompletion: true, createdAt: true },
  });

  let todayUSD = 0, weekUSD = 0, monthUSD = 0, todayCalls = 0, monthCalls = 0;
  const byModel = new Map<string, AiSpendRow>();
  const unpriced = new Set<string>();
  for (const r of rows) {
    const cost = estimateCostUSD(r.model, r.tokensPrompt, r.tokensCompletion);
    if (cost === null) unpriced.add(r.model);
    const c = cost ?? 0;
    if (r.createdAt >= monthStart) {
      monthUSD += c; monthCalls++;
      const row = byModel.get(r.model) ?? { model: r.model, calls: 0, tokensIn: 0, tokensOut: 0, costUSD: cost === null ? null : 0 };
      row.calls++; row.tokensIn += r.tokensPrompt; row.tokensOut += r.tokensCompletion;
      if (row.costUSD !== null && cost !== null) row.costUSD += cost;
      byModel.set(r.model, row);
    }
    if (r.createdAt >= week) weekUSD += c;
    if (r.createdAt >= today) { todayUSD += c; todayCalls++; }
  }
  return {
    todayUSD, weekUSD, monthUSD, todayCalls, monthCalls,
    byModelMonth: [...byModel.values()].sort((a, b) => (b.costUSD ?? 0) - (a.costUSD ?? 0)),
    unpriced: [...unpriced],
    generatedAt: now.toISOString(),
  };
}

