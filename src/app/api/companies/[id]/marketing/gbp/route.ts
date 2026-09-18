import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { assertModule } from "@/lib/billing";

// GET /api/companies/[id]/marketing/gbp?days=30&gbp=<integrationId>
//
// `gbp` escolhe QUAL perfil ler quando a empresa tem mais de uma unidade
// conectada. Omitido = consolidado (soma de todos os perfis).
//
// Consolidado vale pros NÚMEROS (impressões, ações, avaliações, termos) — são
// grandezas somáveis da empresa inteira. Não vale pro cartão de saúde do
// perfil: endereço, categoria e horário pertencem a UMA unidade, e misturar
// duas viraria um perfil que não existe. Nesse modo, `profileHealth` volta null
// e a tela pede pra escolher a unidade.
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

  // ─── Perfis conectados + qual deles ler ──────────────────────────────────
  const perfis = await prisma.marketingIntegration.findMany({
    where: { companyId, provider: "BUSINESS_PROFILE" },
    select: {
      id: true, status: true, lastSyncAt: true, lastSyncStatus: true, lastError: true,
      accountId: true, accountLabel: true, nickname: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (perfis.length === 0) {
    return NextResponse.json({
      connected: false,
      message: "Google Meu Negócio não conectado para esta empresa.",
    });
  }

  // Só perfil com location escolhida entra no seletor — os pendentes não têm dado.
  const sources = perfis
    .filter((p) => p.accountId)
    .map((p) => ({
      id: p.id,
      label: p.nickname || p.accountLabel || p.accountId || "(sem nome)",
      accountLabel: p.accountLabel,
      nickname: p.nickname,
      status: p.status,
      lastSyncAt: p.lastSyncAt,
    }));

  const gbpParam = url.searchParams.get("gbp");
  // Id que não é desta empresa cai no consolidado — link salvo continua abrindo.
  const selected = gbpParam && sources.some((s) => s.id === gbpParam) ? gbpParam : "all";
  const gbpWhere = selected === "all" ? {} : { integrationId: selected };

  // `integration` é o status mostrado no cabeçalho. Com um perfil escolhido é o
  // dele; no consolidado é o de sync mais ANTIGO entre os perfis — "atualizado
  // até" só é verdade se valer pra todos.
  const integration =
    selected !== "all"
      ? perfis.find((p) => p.id === selected)!
      : (() => {
          const comSync = perfis.filter((p) => p.accountId && p.lastSyncAt);
          if (comSync.length === 0) return perfis[0];
          return comSync.reduce((antigo, p) => (p.lastSyncAt! < antigo.lastSyncAt! ? p : antigo));
        })();

  // Cartão de saúde do perfil só faz sentido pra UMA unidade (ver nota no topo).
  const perfilUnico = selected !== "all" || sources.length <= 1;

  // ─── Agregados em paralelo ───────────────────────────────────────────────
  const [insightsCurrent, insightsPrev, dailyRaw, reviewStats, recentReviews, profileSnapshot] = await Promise.all([
    // KPIs do período atual
    prisma.gbpInsight.aggregate({
      where: { companyId, ...gbpWhere, date: { gte: periodStart, lte: periodEnd } },
      _sum: {
        impressionsSearchDesktop: true, impressionsSearchMobile: true,
        impressionsMapsDesktop: true, impressionsMapsMobile: true,
        callClicks: true, websiteClicks: true, directionRequests: true,
      },
    }),
    // KPIs período anterior
    prisma.gbpInsight.aggregate({
      where: { companyId, ...gbpWhere, date: { gte: prevStart, lte: prevEnd } },
      _sum: {
        impressionsSearchDesktop: true, impressionsSearchMobile: true,
        impressionsMapsDesktop: true, impressionsMapsMobile: true,
        callClicks: true, websiteClicks: true, directionRequests: true,
      },
    }),
    // Série diária pro gráfico (search/maps + ações)
    prisma.gbpInsight.findMany({
      where: { companyId, ...gbpWhere, date: { gte: periodStart, lte: periodEnd } },
      select: {
        date: true,
        impressionsSearchDesktop: true, impressionsSearchMobile: true,
        impressionsMapsDesktop: true, impressionsMapsMobile: true,
        callClicks: true, websiteClicks: true, directionRequests: true,
      },
      orderBy: { date: "asc" },
    }),
    // Rating médio + total reviews (lifetime, não filtrado por período)
    prisma.gbpReview.aggregate({
      where: { companyId, ...gbpWhere },
      _avg: { starRating: true },
      _count: { id: true },
    }),
    // 5 reviews mais recentes
    prisma.gbpReview.findMany({
      where: { companyId, ...gbpWhere },
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
      where: perfilUnico
        ? { companyId, ...(selected !== "all" ? { integrationId: selected } : {}) }
        : { id: "__nenhum__" }, // consolidado com 2+ unidades: sem cartão de perfil
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

  // No consolidado o mesmo termo vem uma vez por unidade — somar ANTES de cortar
  // o top 5. Com `take: 5` direto no banco, duas unidades disputando o mesmo
  // termo ocupariam duas vagas do pódio com metade do número cada.
  const [curKeywordsRaw, prevKeywords] = await Promise.all([
    prisma.gbpSearchKeyword.findMany({
      where: { companyId, ...gbpWhere, year: curMonth.year, month: curMonth.month },
      select: { keyword: true, impressions: true, isThreshold: true },
    }),
    prisma.gbpSearchKeyword.findMany({
      where: { companyId, ...gbpWhere, year: prevMonth.year, month: prevMonth.month },
      select: { keyword: true, impressions: true },
    }),
  ]);

  const somaPorTermo = (linhas: { keyword: string; impressions: number; isThreshold?: boolean }[]) => {
    const acc = new Map<string, { keyword: string; impressions: number; isThreshold: boolean }>();
    for (const l of linhas) {
      const cur = acc.get(l.keyword) ?? { keyword: l.keyword, impressions: 0, isThreshold: false };
      cur.impressions += l.impressions;
      // "<15" do Google vira threshold. Somando unidades, basta uma ser
      // aproximada pro total ser aproximado.
      cur.isThreshold = cur.isThreshold || !!l.isThreshold;
      acc.set(l.keyword, cur);
    }
    return Array.from(acc.values()).sort((a, b) => b.impressions - a.impressions);
  };

  const curKeywords = somaPorTermo(curKeywordsRaw).slice(0, 5);
  const prevKeywordMap = new Map(somaPorTermo(prevKeywords).map((k) => [k.keyword, k.impressions]));

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
      nickname: integration.nickname,
    },
    // Perfis conectados + qual recorte foi aplicado. A tela só mostra o seletor
    // quando há mais de um.
    sources,
    selected,
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
    // Uma linha por (dia, unidade) — no consolidado o mesmo dia aparece N vezes
    // e o gráfico desenharia degrau. Agrupa por data antes de mandar.
    dailySeries: (() => {
      const porDia = new Map<string, {
        date: Date; search: number; maps: number; calls: number; website: number; directions: number;
      }>();
      for (const row of dailyRaw) {
        const key = row.date.toISOString().slice(0, 10);
        const slot = porDia.get(key) ?? {
          date: row.date, search: 0, maps: 0, calls: 0, website: 0, directions: 0,
        };
        slot.search += (row.impressionsSearchDesktop ?? 0) + (row.impressionsSearchMobile ?? 0);
        slot.maps += (row.impressionsMapsDesktop ?? 0) + (row.impressionsMapsMobile ?? 0);
        slot.calls += row.callClicks ?? 0;
        slot.website += row.websiteClicks ?? 0;
        slot.directions += row.directionRequests ?? 0;
        porDia.set(key, slot);
      }
      return Array.from(porDia.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, v]) => v);
    })(),
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
    // true = profileHealth veio null porque o recorte é consolidado com 2+
    // unidades, não porque falta sync. A tela usa pra pedir a escolha da unidade
    // em vez de mostrar "aguardando primeira sincronização".
    profileHealthNeedsPick: !perfilUnico,
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
