/**
 * Sincronização do Google Business Profile (GBP / "Meu Negócio").
 *
 * Para cada integração ativa (provider=BUSINESS_PROFILE), busca os últimos
 * N dias e popula 4 tabelas:
 *  - GbpInsight         (1 linha/dia: views + ações)
 *  - GbpReview          (1 linha/review com replies)
 *  - GbpSearchKeyword   (top termos do mês corrente + anterior)
 *  - GbpProfileSnapshot (snapshot do perfil + completenessScore)
 *
 * APIs usadas:
 *  - businessprofileperformance.googleapis.com (insights + keywords)
 *  - mybusiness.googleapis.com/v4              (reviews — API legacy)
 *  - mybusinessbusinessinformation.googleapis.com (profile)
 *  - mybusinessaccountmanagement.googleapis.com   (descobrir accountName parent)
 *
 * Usa upsert pra ser idempotente — pode rodar várias vezes no mesmo dia.
 *
 * IMPORTANTE: o `accountId` salvo na MarketingIntegration é só "locations/N";
 * o `accountName` parent ("accounts/X") é descoberto runtime — caching dele
 * em `accountLabel` deixaríamos cache stale se a empresa mudasse de conta.
 */

import { prisma } from "../prisma";
import { googleFetch } from "./token";

const PERF_API = "https://businessprofileperformance.googleapis.com/v1";
const INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
const ACCT_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const REVIEWS_API = "https://mybusiness.googleapis.com/v4";

interface SyncResult {
  insights: number;
  reviews: number;
  keywords: number;
  profileSynced: boolean;
}

/** Métricas que pedimos pro endpoint fetchMultiDailyMetricsTimeSeries. */
const DAILY_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_CONVERSATIONS",
  "BUSINESS_BOOKINGS",
] as const;

type DailyMetric = (typeof DAILY_METRICS)[number];

/** Map de métrica → coluna do GbpInsight. */
const METRIC_TO_COLUMN: Record<DailyMetric, keyof DailyMetricBuckets> = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "impressionsMapsDesktop",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "impressionsSearchDesktop",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "impressionsMapsMobile",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "impressionsSearchMobile",
  CALL_CLICKS: "callClicks",
  WEBSITE_CLICKS: "websiteClicks",
  BUSINESS_DIRECTION_REQUESTS: "directionRequests",
  BUSINESS_CONVERSATIONS: "conversations",
  BUSINESS_BOOKINGS: "bookings",
};

interface DailyMetricBuckets {
  impressionsSearchDesktop: number;
  impressionsSearchMobile: number;
  impressionsMapsDesktop: number;
  impressionsMapsMobile: number;
  callClicks: number;
  websiteClicks: number;
  directionRequests: number;
  conversations: number;
  bookings: number;
}

function emptyBuckets(): DailyMetricBuckets {
  return {
    impressionsSearchDesktop: 0,
    impressionsSearchMobile: 0,
    impressionsMapsDesktop: 0,
    impressionsMapsMobile: 0,
    callClicks: 0,
    websiteClicks: 0,
    directionRequests: 0,
    conversations: 0,
    bookings: 0,
  };
}

/**
 * Roda o sync completo de uma integração GBP.
 * Por padrão sincroniza os últimos 35 dias de insights, todas reviews,
 * keywords dos últimos 3 meses, e snapshot do perfil.
 */
export async function syncGbp(integrationId: string, daysBack = 35): Promise<SyncResult> {
  const integ = await prisma.marketingIntegration.findUnique({
    where: { id: integrationId },
    select: { id: true, companyId: true, accountId: true, provider: true },
  });
  if (!integ) throw new Error("Integração não encontrada");
  if (integ.provider !== "BUSINESS_PROFILE") throw new Error("Integração não é BUSINESS_PROFILE");
  if (!integ.accountId) throw new Error("Selecione um perfil GBP antes de sincronizar");

  const locationName = integ.accountId;            // "locations/N"
  let insightsCount = 0;
  let reviewsCount = 0;
  let keywordsCount = 0;
  let profileSynced = false;
  const partialErrors: string[] = [];

  // Cada etapa roda em try/catch próprio — uma falhar não derruba as outras.
  // Erros parciais são acumulados e expostos em lastError pra UI mostrar.

  try {
    profileSynced = await syncProfile(integrationId, integ.companyId, locationName);
  } catch (e: any) {
    partialErrors.push(`profile: ${e.message?.slice(0, 200) ?? e}`);
  }

  try {
    insightsCount = await syncInsights(integrationId, integ.companyId, locationName, daysBack);
  } catch (e: any) {
    partialErrors.push(`insights: ${e.message?.slice(0, 200) ?? e}`);
  }

  try {
    const accountName = await findParentAccountName(integrationId, locationName);
    if (!accountName) {
      partialErrors.push("reviews: não foi possível descobrir a conta-mãe da location");
    } else {
      reviewsCount = await syncReviews(integrationId, integ.companyId, accountName, locationName);
    }
  } catch (e: any) {
    partialErrors.push(`reviews: ${e.message?.slice(0, 200) ?? e}`);
  }

  try {
    keywordsCount = await syncKeywords(integrationId, integ.companyId, locationName);
  } catch (e: any) {
    partialErrors.push(`keywords: ${e.message?.slice(0, 200) ?? e}`);
  }

  // Status final: ok se nada falhou, warning se alguma etapa falhou mas outras
  // funcionaram, error só se TUDO falhou (nenhum dado novo).
  const allFailed = partialErrors.length >= 4;
  const status = partialErrors.length === 0 ? "ok" : allFailed ? "error" : "warning";
  const lastError = partialErrors.length > 0 ? partialErrors.join(" | ") : null;

  await prisma.marketingIntegration.update({
    where: { id: integrationId },
    data: {
      lastSyncAt: new Date(),
      lastSyncStatus: status,
      lastError: lastError?.slice(0, 1000) ?? null,
      status: allFailed ? "EXPIRED" : "ACTIVE",
    },
  });

  if (allFailed) {
    throw new Error(`Todas as etapas do sync GBP falharam: ${lastError}`);
  }

  return { insights: insightsCount, reviews: reviewsCount, keywords: keywordsCount, profileSynced };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. PROFILE SNAPSHOT
// ═══════════════════════════════════════════════════════════════════════════

async function syncProfile(integrationId: string, companyId: string, locationName: string): Promise<boolean> {
  const readMask = [
    "name",
    "title",
    "categories",
    "storefrontAddress",
    "phoneNumbers",
    "websiteUri",
    "regularHours",
    "profile",
  ].join(",");

  const r = await googleFetch(integrationId, `${INFO_API}/${locationName}?readMask=${encodeURIComponent(readMask)}`);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`GBP profile falhou (${r.status}): ${txt.slice(0, 300)}`);
  }
  const data = await r.json();

  const title = data.title ?? null;
  const primaryCategory = data.categories?.primaryCategory?.displayName ?? null;
  const storefrontAddress = data.storefrontAddress ?? null;
  const primaryPhone = data.phoneNumbers?.primaryPhone ?? null;
  const websiteUri = data.websiteUri ?? null;
  const regularHours = data.regularHours ?? null;
  const description = data.profile?.description ?? null;
  // photoCount não vem na Business Information API v1 — fica null até API mudar
  const photoCount: number | null = null;

  const completenessScore = calcCompleteness({
    title, primaryCategory, storefrontAddress, primaryPhone, websiteUri, regularHours, description, photoCount,
  });

  await prisma.gbpProfileSnapshot.create({
    data: {
      companyId,
      title,
      primaryCategory,
      storefrontAddress: storefrontAddress ?? undefined,
      primaryPhone,
      websiteUri,
      regularHours: regularHours ?? undefined,
      description,
      photoCount,
      completenessScore,
    },
  });
  return true;
}

/** 0-100. Pontuação fixa por campo presente. Tolerante a categorias diferentes. */
function calcCompleteness(s: {
  title: string | null;
  primaryCategory: string | null;
  storefrontAddress: any;
  primaryPhone: string | null;
  websiteUri: string | null;
  regularHours: any;
  description: string | null;
  photoCount: number | null;
}): number {
  let score = 0;
  if (s.title) score += 10;
  if (s.primaryCategory) score += 15;
  if (s.storefrontAddress?.addressLines?.length) score += 15;
  if (s.primaryPhone) score += 10;
  if (s.websiteUri) score += 10;
  if (s.regularHours?.periods?.length) score += 15;
  if (s.description && s.description.length >= 100) score += 10;
  if (s.photoCount !== null && s.photoCount >= 5) score += 10;
  // Bônus: horário tem todos os 7 dias preenchidos
  const days = new Set<string>();
  for (const p of s.regularHours?.periods ?? []) {
    if (p.openDay) days.add(p.openDay);
  }
  if (days.size === 7) score += 5;
  return Math.min(100, score);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. INSIGHTS DIÁRIOS
// ═══════════════════════════════════════════════════════════════════════════

async function syncInsights(integrationId: string, companyId: string, locationName: string, daysBack: number): Promise<number> {
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - daysBack);

  // Monta query string com múltiplos dailyMetrics (repete o param)
  const params: string[] = [];
  for (const m of DAILY_METRICS) params.push(`dailyMetrics=${m}`);
  params.push(`dailyRange.start_date.year=${start.getUTCFullYear()}`);
  params.push(`dailyRange.start_date.month=${start.getUTCMonth() + 1}`);
  params.push(`dailyRange.start_date.day=${start.getUTCDate()}`);
  params.push(`dailyRange.end_date.year=${end.getUTCFullYear()}`);
  params.push(`dailyRange.end_date.month=${end.getUTCMonth() + 1}`);
  params.push(`dailyRange.end_date.day=${end.getUTCDate()}`);

  const url = `${PERF_API}/${locationName}:fetchMultiDailyMetricsTimeSeries?${params.join("&")}`;
  const r = await googleFetch(integrationId, url);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`GBP insights falhou (${r.status}): ${txt.slice(0, 300)}`);
  }
  const data = await r.json();

  // Resposta: { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [{ dailyMetric, timeSeries: { datedValues: [{ date: {year,month,day}, value }] } }] }] }
  // Agrega por data num único map → upsert.
  const byDate = new Map<string, DailyMetricBuckets>();

  for (const outer of data.multiDailyMetricTimeSeries ?? []) {
    for (const series of outer.dailyMetricTimeSeries ?? []) {
      const metric = series.dailyMetric as DailyMetric;
      const column = METRIC_TO_COLUMN[metric];
      if (!column) continue;

      for (const dv of series.timeSeries?.datedValues ?? []) {
        const d = dv.date;
        if (!d) continue;
        const key = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
        if (!byDate.has(key)) byDate.set(key, emptyBuckets());
        const bucket = byDate.get(key)!;
        bucket[column] = parseInt(dv.value ?? "0", 10) || 0;
      }
    }
  }

  let count = 0;
  for (const [key, buckets] of byDate) {
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    await prisma.gbpInsight.upsert({
      where: { companyId_date: { companyId, date } },
      create: { companyId, date, ...buckets },
      update: buckets,
    });
    count++;
  }
  return count;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. REVIEWS (API v4 legacy)
// ═══════════════════════════════════════════════════════════════════════════

/** Star rating vem como string ("FIVE", "FOUR"...) — converte pra int 1-5. */
const STAR_MAP: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

async function syncReviews(integrationId: string, companyId: string, accountName: string, locationName: string): Promise<number> {
  // accountName = "accounts/X", locationName = "locations/Y"
  // API v4 path: accounts/X/locations/Y/reviews
  const basePath = `${accountName}/${locationName}/reviews`;
  let pageToken: string | undefined;
  let count = 0;
  const MAX_PAGES = 5;     // 5 × 50 = até 250 reviews por sync (seguro)

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      pageSize: "50",
      orderBy: "updateTime desc",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const r = await googleFetch(integrationId, `${REVIEWS_API}/${basePath}?${params}`);
    if (!r.ok) {
      const txt = await r.text();
      // Lança erro pro catch externo registrar em lastError visível na UI.
      // Antes era console.warn silencioso, escondia falha (rating ficava "—" sem motivo).
      throw new Error(`reviews API ${r.status}: ${txt.slice(0, 200)}`);
    }
    const data = await r.json();

    for (const rev of data.reviews ?? []) {
      const googleReviewId = rev.reviewId
        ? `${basePath}/${rev.reviewId}`
        : rev.name;
      if (!googleReviewId) continue;

      const starRating = STAR_MAP[rev.starRating] ?? 0;
      const reviewerName = rev.reviewer?.displayName ?? null;
      const reviewerPhotoUrl = rev.reviewer?.profilePhotoUrl ?? null;
      const comment = rev.comment ?? null;
      const createTime = rev.createTime ? new Date(rev.createTime) : new Date();
      const updateTime = rev.updateTime ? new Date(rev.updateTime) : null;
      const replyComment = rev.reviewReply?.comment ?? null;
      const replyUpdateTime = rev.reviewReply?.updateTime ? new Date(rev.reviewReply.updateTime) : null;

      await prisma.gbpReview.upsert({
        where: { googleReviewId },
        create: {
          companyId, googleReviewId,
          reviewerName, reviewerPhotoUrl, starRating, comment,
          createTime, updateTime,
          replyComment, replyUpdateTime,
        },
        update: {
          reviewerName, reviewerPhotoUrl, starRating, comment, updateTime,
          replyComment, replyUpdateTime,
        },
      });
      count++;
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return count;
}

/**
 * Descobre o accountName parent de uma location. Lista todas as contas e
 * pra cada conta, lista locations procurando match. Custo: 1 + N chamadas
 * onde N = nº de contas do usuário (normalmente 1-3).
 */
async function findParentAccountName(integrationId: string, locationName: string): Promise<string | null> {
  const accR = await googleFetch(integrationId, `${ACCT_API}/accounts`);
  if (!accR.ok) return null;
  const accData = await accR.json();

  for (const acc of accData.accounts ?? []) {
    const locR = await googleFetch(integrationId, `${INFO_API}/${acc.name}/locations?readMask=name&pageSize=100`);
    if (!locR.ok) continue;
    const locData = await locR.json();
    for (const loc of locData.locations ?? []) {
      if (loc.name === locationName) return acc.name;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. SEARCH KEYWORDS (mensal)
// ═══════════════════════════════════════════════════════════════════════════

async function syncKeywords(integrationId: string, companyId: string, locationName: string): Promise<number> {
  const now = new Date();
  // Cobre mês corrente + 2 anteriores
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const params = new URLSearchParams({
    "monthlyRange.startMonth.year": String(startDate.getUTCFullYear()),
    "monthlyRange.startMonth.month": String(startDate.getUTCMonth() + 1),
    "monthlyRange.endMonth.year": String(endDate.getUTCFullYear()),
    "monthlyRange.endMonth.month": String(endDate.getUTCMonth() + 1),
  });

  const url = `${PERF_API}/${locationName}/searchkeywords/impressions/monthly?${params}`;
  const r = await googleFetch(integrationId, url);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`keywords API ${r.status}: ${txt.slice(0, 200)}`);
  }
  const data = await r.json();

  let count = 0;
  // Resposta: { searchKeywordsCounts: [{ searchKeyword, insightsValue: { value | threshold } }] }
  // O Google retorna agregado do range inteiro num único item por keyword, mas a
  // doc menciona que pode quebrar por mês. Testamos com fallback pro mês corrente.
  for (const item of data.searchKeywordsCounts ?? []) {
    const keyword = item.searchKeyword;
    if (!keyword) continue;
    const value = item.insightsValue?.value;
    const threshold = item.insightsValue?.threshold;
    const impressions = parseInt(value ?? threshold ?? "0", 10) || 0;
    const isThreshold = value == null && threshold != null;

    // Atribuído ao mês corrente (range = 3 meses, mas valor é agregado)
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth() + 1;
    await prisma.gbpSearchKeyword.upsert({
      where: { companyId_year_month_keyword: { companyId, year: y, month: m, keyword } },
      create: { companyId, year: y, month: m, keyword, impressions, isThreshold },
      update: { impressions, isThreshold },
    });
    count++;
  }
  return count;
}
