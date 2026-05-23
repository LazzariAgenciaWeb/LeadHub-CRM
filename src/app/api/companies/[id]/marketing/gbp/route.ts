import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { assertModule } from "@/lib/billing";

// GET /api/companies/[id]/marketing/gbp?days=30
//
// Retorna tudo do Google Business Profile pra renderizar a seção GBP no
// Dashboard de Marketing num único round-trip:
//   - connection: integração existe? quando foi o último sync?
//   - kpis: impressões 30d, ações 30d, rating médio + comparação período anterior
//   - dailySeries: linha de Search vs Maps por dia
//   - reviews: últimas 5 reviews com flag de "respondida"
//   - keywords: top 5 termos do mês corrente + delta vs mês anterior
//   - profileHealth: score + checks faltando
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

  // ─── Janelas de período ──────────────────────────────────────────────────
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const periodEnd = today;
  const periodStart = new Date(today);
  periodStart.setUTCDate(periodStart.getUTCDate() - days + 1);
  const prevEnd = new Date(periodStart);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - days + 1);

  // ─── Status da integração ────────────────────────────────────────────────
  const integration = await prisma.marketingIntegration.findFirst({
    where: { companyId, provider: "BUSINESS_PROFILE" },
    select: { id: true, status: true, lastSyncAt: true, lastSyncStatus: true, lastError: true, accountLabel: true },
  });

  if (!integration) {
    return NextResponse.json({
      connected: false,
      message: "Google Meu Negócio não conectado para esta empresa.",
    });
  }

  // ─── Agregados em paralelo ───────────────────────────────────────────────
  const [insightsCurrent, insightsPrev, dailyRaw, reviewStats, recentReviews, profileSnapshot] = await Promise.all([
    // KPIs do período atual
    prisma.gbpInsight.aggregate({
      where: { companyId, date: { gte: periodStart, lte: periodEnd } },
      _sum: {
        impressionsSearchDesktop: true, impressionsSearchMobile: true,
        impressionsMapsDesktop: true, impressionsMapsMobile: true,
        callClicks: true, websiteClicks: true, directionRequests: true,
      },
    }),
    // KPIs período anterior
    prisma.gbpInsight.aggregate({
      where: { companyId, date: { gte: prevStart, lte: prevEnd } },
      _sum: {
        impressionsSearchDesktop: true, impressionsSearchMobile: true,
        impressionsMapsDesktop: true, impressionsMapsMobile: true,
        callClicks: true, websiteClicks: true, directionRequests: true,
      },
    }),
    // Série diária pro gráfico (search vs maps)
    prisma.gbpInsight.findMany({
      where: { companyId, date: { gte: periodStart, lte: periodEnd } },
      select: {
        date: true,
        impressionsSearchDesktop: true, impressionsSearchMobile: true,
        impressionsMapsDesktop: true, impressionsMapsMobile: true,
      },
      orderBy: { date: "asc" },
    }),
    // Rating médio + total reviews (lifetime, não filtrado por período)
    prisma.gbpReview.aggregate({
      where: { companyId },
      _avg: { starRating: true },
      _count: { id: true },
    }),
    // 5 reviews mais recentes
    prisma.gbpReview.findMany({
      where: { companyId },
      orderBy: { createTime: "desc" },
      take: 5,
      select: {
        id: true, googleReviewId: true, reviewerName: true, reviewerPhotoUrl: true,
        starRating: true, comment: true, createTime: true,
        replyComment: true, replyUpdateTime: true,
      },
    }),
    // Profile snapshot mais recente
    prisma.gbpProfileSnapshot.findFirst({
      where: { companyId },
      orderBy: { syncedAt: "desc" },
    }),
  ]);

  // ─── KPI: impressões ─────────────────────────────────────────────────────
  const sumImpressionsCurrent = sumImpressions(insightsCurrent._sum);
  const sumImpressionsPrev = sumImpressions(insightsPrev._sum);
  const sumActionsCurrent = sumActions(insightsCurrent._sum);
  const sumActionsPrev = sumActions(insightsPrev._sum);

  // ─── Keywords: mês corrente + delta vs mês anterior ──────────────────────
  const now = new Date();
  const curMonth = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  const prevMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevMonth = { year: prevMonthDate.getUTCFullYear(), month: prevMonthDate.getUTCMonth() + 1 };

  const [curKeywords, prevKeywords] = await Promise.all([
    prisma.gbpSearchKeyword.findMany({
      where: { companyId, year: curMonth.year, month: curMonth.month },
      orderBy: { impressions: "desc" },
      take: 5,
    }),
    prisma.gbpSearchKeyword.findMany({
      where: { companyId, year: prevMonth.year, month: prevMonth.month },
      select: { keyword: true, impressions: true },
    }),
  ]);
  const prevKeywordMap = new Map(prevKeywords.map((k) => [k.keyword, k.impressions]));

  // ─── Profile Health: checks faltando ─────────────────────────────────────
  const missingChecks: string[] = [];
  if (profileSnapshot) {
    if (!profileSnapshot.primaryCategory) missingChecks.push("Defina a categoria principal do negócio");
    const addr = profileSnapshot.storefrontAddress as any;
    if (!addr?.addressLines?.length) missingChecks.push("Cadastre o endereço completo");
    if (!profileSnapshot.primaryPhone) missingChecks.push("Adicione um telefone de contato");
    if (!profileSnapshot.websiteUri) missingChecks.push("Adicione o site da empresa");
    const hours = profileSnapshot.regularHours as any;
    if (!hours?.periods?.length) missingChecks.push("Configure o horário de funcionamento");
    if (!profileSnapshot.description || profileSnapshot.description.length < 100) {
      missingChecks.push("Escreva uma descrição com pelo menos 100 caracteres");
    }
  }

  // ─── Resposta ────────────────────────────────────────────────────────────
  return NextResponse.json({
    connected: true,
    integration: {
      id: integration.id,
      status: integration.status,
      lastSyncAt: integration.lastSyncAt,
      lastSyncStatus: integration.lastSyncStatus,
      lastError: integration.lastError,
      accountLabel: integration.accountLabel,
    },
    period: { days, start: periodStart, end: periodEnd },
    kpis: {
      impressions: {
        current: sumImpressionsCurrent,
        previous: sumImpressionsPrev,
        deltaPct: pctDelta(sumImpressionsCurrent, sumImpressionsPrev),
      },
      actions: {
        current: sumActionsCurrent,
        previous: sumActionsPrev,
        deltaPct: pctDelta(sumActionsCurrent, sumActionsPrev),
        breakdown: {
          calls: insightsCurrent._sum.callClicks ?? 0,
          website: insightsCurrent._sum.websiteClicks ?? 0,
          directions: insightsCurrent._sum.directionRequests ?? 0,
        },
      },
      rating: {
        // Prioridade: cálculo local (mais preciso) → fallback API v4 top-level.
        // Quando reviews individuais não vêm pela paginação, ainda mostramos
        // os totais que o Google retornou no header do response.
        average: reviewStats._avg.starRating != null
          ? Number(reviewStats._avg.starRating.toFixed(2))
          : (profileSnapshot?.googleAverageRating != null
              ? Number(profileSnapshot.googleAverageRating.toFixed(2))
              : null),
        total: reviewStats._count.id > 0
          ? reviewStats._count.id
          : (profileSnapshot?.googleReviewCount ?? 0),
        // Flag pra UI distinguir: "10 reviews" (locais) vs "10 reviews no Google" (só agregado)
        source: reviewStats._count.id > 0 ? "local" as const : "google" as const,
      },
    },
    dailySeries: dailyRaw.map((row) => ({
      date: row.date,
      search: (row.impressionsSearchDesktop ?? 0) + (row.impressionsSearchMobile ?? 0),
      maps: (row.impressionsMapsDesktop ?? 0) + (row.impressionsMapsMobile ?? 0),
    })),
    reviews: recentReviews.map((r) => ({
      id: r.id,
      googleReviewId: r.googleReviewId,
      reviewerName: r.reviewerName,
      reviewerPhotoUrl: r.reviewerPhotoUrl,
      starRating: r.starRating,
      comment: r.comment,
      createTime: r.createTime,
      hasReply: !!r.replyComment,
      replyUpdateTime: r.replyUpdateTime,
    })),
    keywords: curKeywords.map((k) => {
      const prev = prevKeywordMap.get(k.keyword) ?? 0;
      return {
        keyword: k.keyword,
        impressions: k.impressions,
        isThreshold: k.isThreshold,
        previousImpressions: prev,
        deltaPct: pctDelta(k.impressions, prev),
      };
    }),
    profileHealth: profileSnapshot
      ? {
          score: profileSnapshot.completenessScore,
          syncedAt: profileSnapshot.syncedAt,
          title: profileSnapshot.title,
          primaryCategory: profileSnapshot.primaryCategory,
          missing: missingChecks,
        }
      : null,
  });
}

function sumImpressions(s: any): number {
  return (
    (s.impressionsSearchDesktop ?? 0) +
    (s.impressionsSearchMobile ?? 0) +
    (s.impressionsMapsDesktop ?? 0) +
    (s.impressionsMapsMobile ?? 0)
  );
}

function sumActions(s: any): number {
  return (s.callClicks ?? 0) + (s.websiteClicks ?? 0) + (s.directionRequests ?? 0);
}

function pctDelta(curr: number, prev: number): number | null {
  if (prev === 0) return curr > 0 ? null : 0;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}
