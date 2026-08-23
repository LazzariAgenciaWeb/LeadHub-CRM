import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { assertModule, assertFeature } from "@/lib/billing";

// GET /api/companies/[id]/marketing/ads/breakdown
//        ?provider=META_ADS&campaignId=123[&campaignName=X]&days=30
//
// Abre uma campanha em conjuntos (ad sets) e, dentro deles, os anúncios —
// com as métricas do período agregadas a partir de AdCreativeDaily.
//
// `campaignName` é fallback: as linhas de AdCreative sincronizadas antes da
// migration 20260822_ad_creative_ids não têm externalCampaignId. Sem ele a
// tela viria vazia até o próximo sync.

/** Ads é feature de plano; o módulo Marketing sozinho não basta. */
const ADS_FEATURE = { GOOGLE_ADS: "googleAds", META_ADS: "metaAds" } as const;

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
  const provider = (url.searchParams.get("provider") || "").toUpperCase() === "META_ADS" ? "META_ADS" : "GOOGLE_ADS";

  // Google Ads e Meta Ads são features do plano, não do módulo: o Dashboard de
  // Marketing existe em todos, o dado pago não.
  const adsGate = await assertFeature(session, ADS_FEATURE[provider]);
  if (!adsGate.ok) return adsGate.response;

  const campaignId = url.searchParams.get("campaignId");
  const campaignName = url.searchParams.get("campaignName");
  const days = Math.max(7, Math.min(90, parseInt(url.searchParams.get("days") || "30", 10)));

  if (!campaignId && !campaignName) {
    return NextResponse.json({ error: "campaignId ou campaignName obrigatório" }, { status: 400 });
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const periodStart = new Date(today);
  periodStart.setUTCDate(periodStart.getUTCDate() - days + 1);

  // Anúncios da campanha. Prefere o id; cai pro nome quando o sync antigo não
  // gravou o id (ver comentário no topo).
  const creatives = await prisma.adCreative.findMany({
    where: {
      companyId,
      provider,
      ...(campaignId
        ? { OR: [{ externalCampaignId: campaignId }, ...(campaignName ? [{ externalCampaignId: null, campaignName }] : [])] }
        : { campaignName: campaignName! }),
    },
    select: {
      externalAdId: true, externalAdSetId: true, adGroupName: true, campaignName: true,
      adType: true, status: true, headlines: true, descriptions: true, finalUrl: true,
    },
  });

  if (creatives.length === 0) {
    return NextResponse.json({
      provider,
      campaign: { id: campaignId, name: campaignName },
      adSets: [],
      // A tela usa isso pra explicar o vazio em vez de mostrar "0 conjuntos".
      message: "Nenhum anúncio sincronizado para esta campanha no período.",
    });
  }

  const stats = await prisma.adCreativeDaily.groupBy({
    by: ["externalAdId"],
    where: {
      companyId,
      provider,
      date: { gte: periodStart, lte: today },
      externalAdId: { in: creatives.map((c) => c.externalAdId) },
    },
    _sum: { impressions: true, clicks: true, cost: true, conversions: true, conversionValue: true },
  });

  const num = (v: any) => (v == null ? 0 : Number(v));
  const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);
  const statsByAd = new Map(stats.map((s) => [s.externalAdId, s]));

  // Agrupa por conjunto. Chave = id do conjunto; cai pro nome quando não houver.
  const groups = new Map<string, {
    id: string | null; name: string;
    ads: any[];
    impressions: number; clicks: number; cost: number; conversions: number; conversionValue: number;
  }>();

  for (const c of creatives) {
    const key = c.externalAdSetId ?? `name:${c.adGroupName ?? "(sem conjunto)"}`;
    if (!groups.has(key)) {
      groups.set(key, {
        id: c.externalAdSetId,
        name: c.adGroupName ?? "(sem conjunto)",
        ads: [],
        impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0,
      });
    }
    const g = groups.get(key)!;
    const s = statsByAd.get(c.externalAdId);
    const impressions = num(s?._sum.impressions);
    const clicks = num(s?._sum.clicks);
    const cost = num(s?._sum.cost);
    const conversions = num(s?._sum.conversions);
    const conversionValue = num(s?._sum.conversionValue);

    const headlines = Array.isArray(c.headlines) ? (c.headlines as string[]) : [];
    const descriptions = Array.isArray(c.descriptions) ? (c.descriptions as string[]) : [];

    g.ads.push({
      id: c.externalAdId,
      // Meta não guarda um "título" único — usa o 1º headline, senão o id.
      title: headlines[0] ?? descriptions[0] ?? `Anúncio ${c.externalAdId}`,
      headlines, descriptions,
      adType: c.adType, status: c.status, finalUrl: c.finalUrl,
      impressions, clicks, cost, conversions, conversionValue,
      ctr: safeDiv(clicks, impressions),
      cpc: safeDiv(cost, clicks),
      cpa: safeDiv(cost, conversions),
    });

    g.impressions += impressions;
    g.clicks += clicks;
    g.cost += cost;
    g.conversions += conversions;
    g.conversionValue += conversionValue;
  }

  const adSets = Array.from(groups.values())
    .map((g) => ({
      ...g,
      ctr: safeDiv(g.clicks, g.impressions),
      cpc: safeDiv(g.cost, g.clicks),
      cpa: safeDiv(g.cost, g.conversions),
      roas: safeDiv(g.conversionValue, g.cost),
      // anúncio que mais gastou primeiro
      ads: g.ads.sort((a, b) => b.cost - a.cost || b.impressions - a.impressions),
    }))
    .sort((a, b) => b.cost - a.cost || b.impressions - a.impressions);

  return NextResponse.json({
    provider,
    campaign: { id: campaignId, name: campaignName ?? creatives[0]?.campaignName ?? null },
    totals: {
      adSets: adSets.length,
      ads: adSets.reduce((n, g) => n + g.ads.length, 0),
    },
    adSets,
  });
}
