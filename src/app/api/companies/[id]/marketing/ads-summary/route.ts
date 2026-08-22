import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { assertModule } from "@/lib/billing";

// GET /api/companies/[id]/marketing/ads-summary?days=30
//
// Resumo enxuto do investimento em mídia paga (Google Ads + Meta Ads) numa
// única chamada — alimenta o painel de entrada do Dashboard de Marketing.
//
// Existe separado de /marketing/ads porque aquele endpoint devolve o relatório
// completo (série diária, campanhas, termos, criativos). O painel de entrada só
// precisa dos totais, e ele é a primeira tela que todo mundo abre.
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

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const periodEnd = today;
  const periodStart = new Date(today);
  periodStart.setUTCDate(periodStart.getUTCDate() - days + 1);
  const prevEnd = new Date(periodStart);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - days + 1);

  const sumFields = { impressions: true, clicks: true, cost: true, conversions: true, conversionValue: true } as const;

  const [integrations, curRows, prevRows] = await Promise.all([
    prisma.marketingIntegration.findMany({
      where: { companyId, provider: { in: ["GOOGLE_ADS", "META_ADS"] } },
      select: { provider: true, status: true, accountId: true, accountLabel: true, lastSyncAt: true, lastSyncStatus: true },
    }),
    prisma.adCampaignDaily.groupBy({
      by: ["provider"],
      where: { companyId, date: { gte: periodStart, lte: periodEnd } },
      _sum: sumFields,
      _max: { currency: true },
    }),
    prisma.adCampaignDaily.groupBy({
      by: ["provider"],
      where: { companyId, date: { gte: prevStart, lte: prevEnd } },
      _sum: sumFields,
    }),
  ]);

  const num = (v: any) => (v == null ? 0 : Number(v));
  const byProviderPrev = new Map(prevRows.map((r) => [r.provider, r]));
  const integByProvider = new Map(integrations.map((i) => [i.provider, i]));

  const PROVIDERS = ["GOOGLE_ADS", "META_ADS"] as const;
  const providers = PROVIDERS.map((provider) => {
    const cur = curRows.find((r) => r.provider === provider);
    const prev = byProviderPrev.get(provider);
    const integ = integByProvider.get(provider);
    return {
      provider,
      // "conectado" = existe integração com conta escolhida e não desconectada
      connected: !!integ && !!integ.accountId && integ.status !== "DISCONNECTED",
      status: integ?.status ?? null,
      accountLabel: integ?.accountLabel ?? null,
      lastSyncAt: integ?.lastSyncAt?.toISOString() ?? null,
      lastSyncStatus: integ?.lastSyncStatus ?? null,
      currency: cur?._max.currency ?? null,
      cost: num(cur?._sum.cost),
      clicks: num(cur?._sum.clicks),
      impressions: num(cur?._sum.impressions),
      conversions: num(cur?._sum.conversions),
      conversionValue: num(cur?._sum.conversionValue),
      prevCost: num(prev?._sum.cost),
      prevConversions: num(prev?._sum.conversions),
    };
  });

  const sum = (k: "cost" | "clicks" | "impressions" | "conversions" | "conversionValue" | "prevCost" | "prevConversions") =>
    providers.reduce((acc, p) => acc + p[k], 0);

  const totals = {
    cost: sum("cost"),
    clicks: sum("clicks"),
    impressions: sum("impressions"),
    conversions: sum("conversions"),
    conversionValue: sum("conversionValue"),
    prevCost: sum("prevCost"),
    prevConversions: sum("prevConversions"),
  };

  return NextResponse.json({
    period: { days, start: periodStart.toISOString(), end: periodEnd.toISOString() },
    // moeda predominante entre os provedores com dado
    currency: providers.find((p) => p.currency)?.currency ?? null,
    anyConnected: providers.some((p) => p.connected),
    providers,
    totals,
  });
}
