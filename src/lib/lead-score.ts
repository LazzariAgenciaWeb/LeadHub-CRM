/**
 * Lead scoring — pontuação 0–100 que pinta a borda do card no Kanban
 * pra vendedor enxergar quem está mais "quente" sem abrir o drawer.
 *
 * Filosofia: regra simples, transparente, derivada de dados que já existem.
 * Sem ML, sem cron, sem coluna no banco — calcula no servidor a cada
 * carregamento das pages do CRM. Barato (números agregados que já viemos
 * carregando: tarefas em aberto, último inbound, valor, cliques no link).
 */
import { prisma } from "./prisma";

export interface LeadScoreInput {
  pipeline: string | null;
  value: number | null;
  /** ISO da última mensagem INBOUND. null = nunca respondeu. */
  lastInboundAt: string | null;
  /** Tarefas em aberto. Sinal de "tem ação ativa". */
  openTaskCount: number;
  /** Cliques rastreados no link vinculado. >0 = abriu/clicou alguma proposta. */
  trackingClicks: number;
  /** Cliente abriu o link nos últimos 24h? Sinal mais forte. */
  recentLinkOpen?: boolean;
}

export interface LeadScore {
  value: number;            // 0–100
  tier: "fire" | "hot" | "warm" | "cold" | "icy";
  reasons: string[];        // explicação humana, mostrada no drawer
}

const TIER_THRESHOLDS = [
  { min: 80, tier: "fire" as const },
  { min: 60, tier: "hot"  as const },
  { min: 40, tier: "warm" as const },
  { min: 20, tier: "cold" as const },
  { min: 0,  tier: "icy"  as const },
];

export function computeLeadScore(input: LeadScoreInput): LeadScore {
  let score = 0;
  const reasons: string[] = [];

  // +30 — respondeu nas últimas 24h (sinal mais forte de interesse ativo)
  if (input.lastInboundAt) {
    const ageHours = (Date.now() - new Date(input.lastInboundAt).getTime()) / 3_600_000;
    if (ageHours < 24) { score += 30; reasons.push("+30 respondeu nas últimas 24h"); }
    else if (ageHours < 72) { score += 15; reasons.push("+15 respondeu nos últimos 3 dias"); }
    else if (ageHours > 168) { score -= 20; reasons.push("-20 sem resposta há 7+ dias"); }
  } else {
    score -= 10;
    reasons.push("-10 nunca respondeu via WhatsApp");
  }

  // +25 — abriu o link recentemente (sinal quente)
  if (input.recentLinkOpen) { score += 25; reasons.push("+25 abriu o link recentemente"); }
  else if (input.trackingClicks > 0) { score += 10; reasons.push("+10 já clicou no link"); }

  // +20 — tem tarefa em aberto (vendedor está cuidando)
  if (input.openTaskCount > 0) { score += 20; reasons.push(`+20 ${input.openTaskCount} tarefa(s) em aberto`); }

  // +15 — está em Oportunidades (mais perto do fechamento)
  if (input.pipeline === "OPORTUNIDADES") { score += 15; reasons.push("+15 em Oportunidades"); }
  else if (input.pipeline === "LEADS") { score += 5; reasons.push("+5 em Leads"); }

  // +10 — tem valor de negócio definido
  if (input.value != null && input.value > 0) { score += 10; reasons.push("+10 valor definido"); }

  // Clamp
  score = Math.max(0, Math.min(100, score));

  const tier = TIER_THRESHOLDS.find((t) => score >= t.min)!.tier;
  return { value: score, tier, reasons };
}

export interface LeadScoreSummaryInputs {
  /** lista mínima de leads — só id, pipeline, value, trackingLinkId/clicks. */
  leads: Array<{
    id: string;
    pipeline: string | null;
    value: number | null;
    phone: string;
    companyId: string;
    trackingLink?: { _count: { clickEvents: number } } | null;
  }>;
  /** Mapa leadId → contagem de tarefas em aberto (do attachTaskSummaries) */
  openTaskByLead: Record<string, number>;
}

/**
 * Para uma lista de leads, busca o último inbound message por phone+companyId
 * e o último link_open recente, e retorna mapa leadId → score.
 *
 * Faz 2 queries agregadas (groupBy) — não importa quantos leads.
 */
export async function computeScoresForLeads(
  inputs: LeadScoreSummaryInputs
): Promise<Record<string, LeadScore>> {
  const { leads, openTaskByLead } = inputs;
  if (leads.length === 0) return {};

  // 1) Último INBOUND por (phone, companyId).
  const phoneCompanyPairs = leads.map((l) => ({ phone: l.phone, companyId: l.companyId }));
  const phones = [...new Set(phoneCompanyPairs.map((p) => p.phone))];
  const companyIds = [...new Set(phoneCompanyPairs.map((p) => p.companyId))];

  const lastInboundRaw = await prisma.message.groupBy({
    by: ["phone", "companyId"],
    where: { phone: { in: phones }, companyId: { in: companyIds }, direction: "INBOUND" },
    _max: { receivedAt: true },
  });
  const lastInboundMap = new Map<string, string>();
  for (const row of lastInboundRaw) {
    if (row._max.receivedAt) {
      lastInboundMap.set(`${row.phone}::${row.companyId}`, row._max.receivedAt.toISOString());
    }
  }

  // 2) Aberturas de link nas últimas 24h por trackingLinkId.
  const trackingLinkIds = leads
    .map((l) => (l.trackingLink ? (l as any).trackingLinkId : null))
    .filter(Boolean) as string[];

  const recentOpens = trackingLinkIds.length > 0
    ? await prisma.clickEvent.findMany({
        where: {
          trackingLinkId: { in: trackingLinkIds },
          kind: "OPEN",
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        select: { trackingLinkId: true },
      })
    : [];
  const recentOpenSet = new Set(recentOpens.map((e) => e.trackingLinkId));

  const result: Record<string, LeadScore> = {};
  for (const l of leads) {
    const lastInboundAt = lastInboundMap.get(`${l.phone}::${l.companyId}`) ?? null;
    const recentLinkOpen = (l as any).trackingLinkId
      ? recentOpenSet.has((l as any).trackingLinkId)
      : false;

    result[l.id] = computeLeadScore({
      pipeline: l.pipeline,
      value: l.value,
      lastInboundAt,
      openTaskCount: openTaskByLead[l.id] ?? 0,
      trackingClicks: l.trackingLink?._count.clickEvents ?? 0,
      recentLinkOpen,
    });
  }
  return result;
}
