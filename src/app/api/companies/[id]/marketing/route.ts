import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { classifyTrafficSource, type TrafficBucket } from "@/lib/traffic-classifier";

// GET /api/companies/[id]/marketing?days=30
//
// Retorna agregação completa pra renderizar o Dashboard de Marketing:
//  - KPIs do período + comparação com o período anterior (mesmo tamanho)
//  - Série diária de sessões/usuários
//  - Origens agrupadas por bucket (IA / Instagram / Orgânica / etc.) + detalhes
//  - Top páginas
//  - Países e cidades agregados
//  - Top queries do Search Console
//
// Tudo num só endpoint pra reduzir round-trips.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params;
  const auth = await authorizeVaultAccess(companyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const days = Math.max(7, Math.min(365, parseInt(url.searchParams.get("days") || "30", 10)));

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const periodEnd = today;
  const periodStart = new Date(today);
  periodStart.setUTCDate(periodStart.getUTCDate() - days + 1);
  const prevEnd = new Date(periodStart);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - days + 1);

  // ─── 1. Snapshots — KPIs do período atual + período anterior ─────────────
  const [snapsCurrent, snapsPrev, dailySeries] = await Promise.all([
    prisma.analyticsSnapshot.aggregate({
      where: {
        companyId,
        source: "ga4",
        date: { gte: periodStart, lte: periodEnd },
      },
      _sum: { sessions: true, users: true, newUsers: true, pageviews: true, conversions: true, engagedSessions: true },
      _avg: { bounceRate: true, avgSessionSec: true },
    }),
    prisma.analyticsSnapshot.aggregate({
      where: {
        companyId,
        source: "ga4",
        date: { gte: prevStart, lte: prevEnd },
      },
      _sum: { sessions: true, users: true, conversions: true },
    }),
    prisma.analyticsSnapshot.findMany({
      where: {
        companyId,
        source: "ga4",
        date: { gte: periodStart, lte: periodEnd },
      },
      select: { date: true, sessions: true, users: true, conversions: true },
      orderBy: { date: "asc" },
    }),
  ]);

  // ─── 2. Origens (traffic sources) — agrega por bucket ────────────────────
  const trafficRows = await prisma.analyticsTrafficSource.findMany({
    where: {
      companyId,
      source: "ga4",
      date: { gte: periodStart, lte: periodEnd },
    },
    select: { rawSource: true, rawMedium: true, bucket: true, sessions: true, users: true, conversions: true },
  });

  const bucketsMap = new Map<TrafficBucket, { sessions: number; users: number; conversions: number; details: Map<string, { sessions: number; users: number; conversions: number; rawSource: string; rawMedium: string }> }>();
  for (const r of trafficRows) {
    // Re-classifica caso a regra tenha mudado desde o último sync
    const bucket = (r.bucket as TrafficBucket) || classifyTrafficSource({ source: r.rawSource, medium: r.rawMedium });
    if (!bucketsMap.has(bucket)) {
      bucketsMap.set(bucket, { sessions: 0, users: 0, conversions: 0, details: new Map() });
    }
    const slot = bucketsMap.get(bucket)!;
    slot.sessions += r.sessions;
    slot.users += r.users;
    slot.conversions += r.conversions;

    const detailKey = `${r.rawSource}::${r.rawMedium}`;
    if (!slot.details.has(detailKey)) {
      slot.details.set(detailKey, { sessions: 0, users: 0, conversions: 0, rawSource: r.rawSource, rawMedium: r.rawMedium });
    }
    const det = slot.details.get(detailKey)!;
    det.sessions += r.sessions;
    det.users += r.users;
    det.conversions += r.conversions;
  }

  const trafficBuckets = Array.from(bucketsMap.entries())
    .map(([bucket, v]) => ({
      bucket,
      sessions: v.sessions,
      users: v.users,
      conversions: v.conversions,
      details: Array.from(v.details.values())
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 10),
    }))
    .sort((a, b) => b.sessions - a.sessions);

  // ─── 3. Top páginas (do período inteiro, agregado) ──────────────────────
  const pagesRaw = await prisma.analyticsTopPage.findMany({
    where: {
      companyId,
      source: "ga4",
      date: { gte: periodStart, lte: periodEnd },
    },
    select: { pagePath: true, pageTitle: true, views: true, users: true },
  });
  const pagesMap = new Map<string, { views: number; users: number; title: string | null }>();
  for (const p of pagesRaw) {
    if (!pagesMap.has(p.pagePath)) {
      pagesMap.set(p.pagePath, { views: 0, users: 0, title: p.pageTitle });
    }
    const slot = pagesMap.get(p.pagePath)!;
    slot.views += p.views;
    slot.users += p.users;
    if (!slot.title && p.pageTitle) slot.title = p.pageTitle;
  }
  const topPages = Array.from(pagesMap.entries())
    .map(([path, v]) => ({ path, title: v.title, views: v.views, users: v.users }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 20);

  // ─── 4. Geo — agregado por país ─────────────────────────────────────────
  const geoRaw = await prisma.analyticsGeoData.findMany({
    where: {
      companyId,
      source: "ga4",
      date: { gte: periodStart, lte: periodEnd },
    },
    select: { countryCode: true, countryName: true, region: true, city: true, sessions: true, users: true },
  });
  const countriesMap = new Map<string, { code: string; name: string; sessions: number; users: number; cities: Map<string, { sessions: number; users: number; region: string | null }> }>();
  for (const g of geoRaw) {
    const code = g.countryCode || "??";
    const name = g.countryName || "Desconhecido";
    if (!countriesMap.has(code)) {
      countriesMap.set(code, { code, name, sessions: 0, users: 0, cities: new Map() });
    }
    const c = countriesMap.get(code)!;
    c.sessions += g.sessions;
    c.users += g.users;
    if (g.city) {
      if (!c.cities.has(g.city)) {
        c.cities.set(g.city, { sessions: 0, users: 0, region: g.region });
      }
      const ct = c.cities.get(g.city)!;
      ct.sessions += g.sessions;
      ct.users += g.users;
    }
  }
  const countries = Array.from(countriesMap.values())
    .map((c) => ({
      code: c.code,
      name: c.name,
      sessions: c.sessions,
      users: c.users,
      topCities: Array.from(c.cities.entries())
        .map(([city, v]) => ({ city, sessions: v.sessions, users: v.users, region: v.region }))
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 5),
    }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 20);

  // ─── 5. Search Console — top queries ────────────────────────────────────
  const scRows = await prisma.searchConsoleQuery.findMany({
    where: {
      companyId,
      date: { gte: periodStart, lte: periodEnd },
    },
    select: { query: true, clicks: true, impressions: true, ctr: true, position: true },
  });
  const queriesMap = new Map<string, { clicks: number; impressions: number; positions: number[]; }>();
  for (const q of scRows) {
    if (!queriesMap.has(q.query)) {
      queriesMap.set(q.query, { clicks: 0, impressions: 0, positions: [] });
    }
    const slot = queriesMap.get(q.query)!;
    slot.clicks += q.clicks;
    slot.impressions += q.impressions;
    slot.positions.push(q.position);
  }
  const topQueries = Array.from(queriesMap.entries())
    .map(([query, v]) => ({
      query,
      clicks: v.clicks,
      impressions: v.impressions,
      ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
      position: v.positions.length > 0 ? v.positions.reduce((a, b) => a + b, 0) / v.positions.length : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 30);

  const scTotal = scRows.reduce(
    (acc, r) => ({ clicks: acc.clicks + r.clicks, impressions: acc.impressions + r.impressions }),
    { clicks: 0, impressions: 0 }
  );

  // ─── Resposta ────────────────────────────────────────────────────────────
  function pct(curr: number, prev: number): number | null {
    if (prev === 0) return curr > 0 ? 100 : null;
    return ((curr - prev) / prev) * 100;
  }

  return NextResponse.json({
    period: {
      days,
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      prevStart: prevStart.toISOString(),
      prevEnd: prevEnd.toISOString(),
    },
    kpis: {
      sessions:    { value: snapsCurrent._sum.sessions ?? 0,    delta: pct(snapsCurrent._sum.sessions ?? 0,    snapsPrev._sum.sessions ?? 0) },
      users:       { value: snapsCurrent._sum.users ?? 0,       delta: pct(snapsCurrent._sum.users ?? 0,       snapsPrev._sum.users ?? 0) },
      conversions: { value: snapsCurrent._sum.conversions ?? 0, delta: pct(snapsCurrent._sum.conversions ?? 0, snapsPrev._sum.conversions ?? 0) },
      pageviews:   { value: snapsCurrent._sum.pageviews ?? 0 },
      newUsers:    { value: snapsCurrent._sum.newUsers ?? 0 },
      bounceRate:  { value: snapsCurrent._avg.bounceRate ?? 0 },
      avgSessionSec: { value: snapsCurrent._avg.avgSessionSec ?? 0 },
      engagedSessions: { value: snapsCurrent._sum.engagedSessions ?? 0 },
    },
    dailySeries: dailySeries.map((d) => ({
      date: d.date.toISOString().slice(0, 10),
      sessions: d.sessions,
      users: d.users,
      conversions: d.conversions,
    })),
    trafficBuckets,
    topPages,
    countries,
    topQueries,
    searchConsole: {
      totalClicks: scTotal.clicks,
      totalImpressions: scTotal.impressions,
      avgCtr: scTotal.impressions > 0 ? scTotal.clicks / scTotal.impressions : 0,
    },
    hasData: (snapsCurrent._sum.sessions ?? 0) > 0 || scRows.length > 0,
  });
}
