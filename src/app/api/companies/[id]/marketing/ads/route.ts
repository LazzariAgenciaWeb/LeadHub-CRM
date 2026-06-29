import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { assertModule } from "@/lib/billing";

// GET /api/companies/[id]/marketing/ads?days=30&provider=GOOGLE_ADS
//
// Retorna tudo da plataforma de Ads (Google Ads por enquanto; Meta Ads usa o
// mesmo shape via ?provider=META_ADS) pra renderizar a seção no Dashboard de
// Marketing num único round-trip:
//   - connected: integração existe? último sync?
//   - kpis: custo, cliques, impressões, conversões, valor + CPC/CPA/CTR/ROAS,
//           com comparação vs período anterior
//   - dailySeries: custo × cliques × conversões por dia
//   - campaigns: tabela agregada por campanha
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params;

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "marketing");
  if (!gate.ok) return gate.response;

  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const days = Math.max(7, Math.min(90, parseInt(url.searchParams.get("days") || "30", 10)));
  const providerParam = (url.searchParams.get("provider") || "GOOGLE_ADS").toUpperCase();
  const provider = providerParam === "META_ADS" ? "META_ADS" : "GOOGLE_ADS";

  // ─── Janelas de período ────────────────────────────────────────────────────
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const periodEnd = today;
  const periodStart = new Date(today);
  periodStart.setUTCDate(periodStart.getUTCDate() - days + 1);
  const prevEnd = new Date(periodStart);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - days + 1);

  // ─── Status da integração ──────────────────────────────────────────────────
  const integration = await prisma.marketingIntegration.findFirst({
    where: { companyId, provider },
    select: { id: true, status: true, lastSyncAt: true, lastSyncStatus: true, lastError: true, accountId: true, accountLabel: true },
  });

  if (!integration) {
    return NextResponse.json({
      connected: false,
      provider,
      message: "Plataforma de anúncios não conectada para esta empresa.",
    });
  }

  const sumFields = { impressions: true, clicks: true, cost: true, conversions: true, conversionValue: true } as const;

  // ─── Agregados em paralelo ─────────────────────────────────────────────────
  const [aggCurrent, aggPrev, dailyRaw, byCampaign, byTerm, byAd] = await Promise.all([
    prisma.adCampaignDaily.aggregate({
      where: { companyId, provider, date: { gte: periodStart, lte: periodEnd } },
      _sum: sumFields,
    }),
    prisma.adCampaignDaily.aggregate({
      where: { companyId, provider, date: { gte: prevStart, lte: prevEnd } },
      _sum: sumFields,
    }),
    prisma.adCampaignDaily.groupBy({
      by: ["date"],
      where: { companyId, provider, date: { gte: periodStart, lte: periodEnd } },
      _sum: sumFields,
      orderBy: { date: "asc" },
    }),
    prisma.adCampaignDaily.groupBy({
      by: ["externalCampaignId"],
      where: { companyId, provider, date: { gte: periodStart, lte: periodEnd } },
      _sum: sumFields,
      _max: { campaignName: true, campaignStatus: true, currency: true },
    }),
    // Termos de pesquisa agregados no período
    prisma.adSearchTermDaily.groupBy({
      by: ["searchTerm"],
      where: { companyId, provider, date: { gte: periodStart, lte: periodEnd } },
      _sum: sumFields,
      _max: { campaignName: true },
    }),
    // Métricas por anúncio (pra eleger o destaque)
    prisma.adCreativeDaily.groupBy({
      by: ["externalAdId"],
      where: { companyId, provider, date: { gte: periodStart, lte: periodEnd } },
      _sum: sumFields,
    }),
  ]);

  const num = (v: unknown) => Number(v ?? 0);

  // KPIs current + previous (números planos)
  const cur = {
    cost: num(aggCurrent._sum.cost),
    clicks: num(aggCurrent._sum.clicks),
    impressions: num(aggCurrent._sum.impressions),
    conversions: num(aggCurrent._sum.conversions),
    conversionValue: num(aggCurrent._sum.conversionValue),
  };
  const prev = {
    cost: num(aggPrev._sum.cost),
    clicks: num(aggPrev._sum.clicks),
    impressions: num(aggPrev._sum.impressions),
    conversions: num(aggPrev._sum.conversions),
    conversionValue: num(aggPrev._sum.conversionValue),
  };

  function pct(c: number, p: number): number | null {
    if (p === 0) return c > 0 ? 100 : null;
    return ((c - p) / p) * 100;
  }
  const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);

  const curCpc = safeDiv(cur.cost, cur.clicks);
  const prevCpc = safeDiv(prev.cost, prev.clicks);
  const curCpa = safeDiv(cur.cost, cur.conversions);
  const prevCpa = safeDiv(prev.cost, prev.conversions);

  const kpis = {
    cost:            { current: cur.cost,            previous: prev.cost,            deltaPct: pct(cur.cost, prev.cost) },
    clicks:          { current: cur.clicks,          previous: prev.clicks,          deltaPct: pct(cur.clicks, prev.clicks) },
    impressions:     { current: cur.impressions,     previous: prev.impressions,     deltaPct: pct(cur.impressions, prev.impressions) },
    conversions:     { current: cur.conversions,     previous: prev.conversions,     deltaPct: pct(cur.conversions, prev.conversions) },
    conversionValue: { current: cur.conversionValue, previous: prev.conversionValue, deltaPct: pct(cur.conversionValue, prev.conversionValue) },
    cpc:             { current: curCpc,              previous: prevCpc,              deltaPct: pct(curCpc, prevCpc) },
    cpa:             { current: curCpa,              previous: prevCpa,              deltaPct: pct(curCpa, prevCpa) },
    ctr:             { current: safeDiv(cur.clicks, cur.impressions) }, // 0..1
    roas:            { current: safeDiv(cur.conversionValue, cur.cost) },
  };

  const dailySeries = dailyRaw.map((d) => ({
    date: d.date.toISOString().slice(0, 10),
    cost: num(d._sum.cost),
    clicks: num(d._sum.clicks),
    impressions: num(d._sum.impressions),
    conversions: num(d._sum.conversions),
  }));

  const campaigns = byCampaign
    .map((c) => {
      const cost = num(c._sum.cost);
      const clicks = num(c._sum.clicks);
      const impressions = num(c._sum.impressions);
      const conversions = num(c._sum.conversions);
      const conversionValue = num(c._sum.conversionValue);
      return {
        id: c.externalCampaignId,
        name: c._max.campaignName ?? "(sem nome)",
        status: c._max.campaignStatus ?? null,
        impressions,
        clicks,
        ctr: safeDiv(clicks, impressions),
        cost,
        conversions,
        conversionValue,
        cpc: safeDiv(cost, clicks),
        cpa: safeDiv(cost, conversions),
        roas: safeDiv(conversionValue, cost),
      };
    })
    .sort((a, b) => b.cost - a.cost);

  // ─── Termos de pesquisa (top por cliques) ──────────────────────────────────
  const searchTerms = byTerm
    .map((t) => {
      const cost = num(t._sum.cost);
      const clicks = num(t._sum.clicks);
      const impressions = num(t._sum.impressions);
      const conversions = num(t._sum.conversions);
      return {
        term: t.searchTerm,
        campaignName: t._max.campaignName ?? null,
        impressions,
        clicks,
        ctr: safeDiv(clicks, impressions),
        cpc: safeDiv(cost, clicks),
        cost,
        conversions,
      };
    })
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 100);

  // ─── Anúncio destaque (melhor por conversões, depois custo) ─────────────────
  const adStats = byAd
    .map((a) => ({
      externalAdId: a.externalAdId,
      impressions: num(a._sum.impressions),
      clicks: num(a._sum.clicks),
      cost: num(a._sum.cost),
      conversions: num(a._sum.conversions),
      conversionValue: num(a._sum.conversionValue),
    }))
    .sort((a, b) => b.conversions - a.conversions || b.conversionValue - a.conversionValue || b.cost - a.cost);

  const topAdIds = adStats.slice(0, 5).map((a) => a.externalAdId);
  const creatives = topAdIds.length
    ? await prisma.adCreative.findMany({
        where: { companyId, provider, externalAdId: { in: topAdIds } },
        select: {
          externalAdId: true, campaignName: true, adGroupName: true, adType: true,
          headlines: true, descriptions: true, finalUrl: true, path1: true, path2: true,
        },
      })
    : [];
  const creativeById = new Map(creatives.map((c) => [c.externalAdId, c]));

  const topAds = adStats
    .slice(0, 5)
    .map((a) => {
      const c = creativeById.get(a.externalAdId);
      return {
        id: a.externalAdId,
        campaignName: c?.campaignName ?? null,
        adGroupName: c?.adGroupName ?? null,
        adType: c?.adType ?? null,
        headlines: (c?.headlines as string[] | null) ?? [],
        descriptions: (c?.descriptions as string[] | null) ?? [],
        finalUrl: c?.finalUrl ?? null,
        path1: c?.path1 ?? null,
        path2: c?.path2 ?? null,
        impressions: a.impressions,
        clicks: a.clicks,
        ctr: safeDiv(a.clicks, a.impressions),
        cost: a.cost,
        conversions: a.conversions,
        cpa: safeDiv(a.cost, a.conversions),
      };
    })
    // só mostra anúncios que têm conteúdo pra renderizar a prévia
    .filter((a) => a.headlines.length > 0 || a.descriptions.length > 0);

  // Moeda predominante (qualquer campanha que tenha)
  const currency = byCampaign.find((c) => c._max.currency)?._max.currency ?? null;

  return NextResponse.json({
    connected: true,
    provider,
    integration,
    period: { days, start: periodStart.toISOString(), end: periodEnd.toISOString() },
    currency,
    kpis,
    dailySeries,
    campaigns,
    searchTerms,
    topAds,
    hasData: cur.impressions > 0 || cur.cost > 0 || campaigns.length > 0,
  });
}
