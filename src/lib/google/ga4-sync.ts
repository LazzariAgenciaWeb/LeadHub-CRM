/**
 * Sincronização do Google Analytics 4 (Data API v1beta).
 *
 * Para cada integração ativa, busca os últimos N dias e popula:
 *  - AnalyticsSnapshot      (1 linha/dia: KPIs gerais)
 *  - AnalyticsTopPage       (top 50 páginas/dia)
 *  - AnalyticsTrafficSource (cada source/medium → bucket classificado)
 *  - AnalyticsGeoData       (cada país/cidade)
 *
 * Usa upsert pra ser idempotente — pode rodar várias vezes ao dia sem duplicar.
 *
 * Docs: https://developers.google.com/analytics/devguides/reporting/data/v1
 */

import { prisma } from "../prisma";
import { googleFetch } from "./token";
import { classifyTrafficSource } from "../traffic-classifier";

const DATA_API = "https://analyticsdata.googleapis.com/v1beta";

interface RunReportArgs {
  propertyId: string;       // ex: "properties/123456789"
  startDate: string;        // "YYYY-MM-DD" ou "Ndaysago"
  endDate: string;
  dimensions: string[];
  metrics: string[];
  limit?: number;
  orderBy?: { metric: string; desc?: boolean };
}

interface RunReportRow {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}

interface RunReportResponse {
  rows?: RunReportRow[];
  rowCount?: number;
  // ...outros campos
}

async function runReport(integrationId: string, args: RunReportArgs): Promise<RunReportRow[]> {
  const body: any = {
    dateRanges: [{ startDate: args.startDate, endDate: args.endDate }],
    dimensions: args.dimensions.map((name) => ({ name })),
    metrics: args.metrics.map((name) => ({ name })),
    limit: args.limit ?? 500,
    keepEmptyRows: false,
  };
  if (args.orderBy) {
    body.orderBys = [{ metric: { metricName: args.orderBy.metric }, desc: args.orderBy.desc ?? true }];
  }

  const r = await googleFetch(
    integrationId,
    `${DATA_API}/${args.propertyId}:runReport`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`GA4 runReport falhou (${r.status}): ${txt.slice(0, 500)}`);
  }
  const data = (await r.json()) as RunReportResponse;
  return data.rows ?? [];
}

/**
 * Roda o sync completo de uma integração GA4.
 * Por padrão sincroniza os últimos 35 dias (cobre 30d + buffer).
 */
export async function syncGA4(integrationId: string, daysBack = 35): Promise<{
  snapshots: number;
  topPages: number;
  trafficSources: number;
  geoRows: number;
}> {
  const integ = await prisma.marketingIntegration.findUnique({
    where: { id: integrationId },
    select: { id: true, companyId: true, accountId: true, provider: true },
  });
  if (!integ) throw new Error("Integração não encontrada");
  if (integ.provider !== "GA4") throw new Error("Integração não é GA4");
  if (!integ.accountId) throw new Error("Selecione uma propriedade GA4 antes de sincronizar");

  const propertyId = integ.accountId; // já no formato "properties/N"
  const startDate = `${daysBack}daysAgo`;
  const endDate = "today";

  let snapshotsCount = 0;
  let topPagesCount = 0;
  let trafficCount = 0;
  let geoCount = 0;

  try {
    // ─── 1. KPIs diários (sessions, users, pageviews, bounceRate, conversions, sessionDuration) ───
    const kpiRows = await runReport(integrationId, {
      propertyId,
      startDate,
      endDate,
      dimensions: ["date"],
      metrics: [
        "sessions",
        "totalUsers",
        "newUsers",
        "screenPageViews",
        "bounceRate",
        "averageSessionDuration",
        "engagedSessions",
        "conversions",
      ],
    });

    for (const row of kpiRows) {
      const dateStr = row.dimensionValues[0].value; // "20260501"
      const date = parseGADate(dateStr);
      const v = row.metricValues;

      await prisma.analyticsSnapshot.upsert({
        where: {
          companyId_date_source: {
            companyId: integ.companyId,
            date,
            source: "ga4",
          },
        },
        create: {
          companyId: integ.companyId,
          date,
          source: "ga4",
          sessions: parseInt(v[0].value, 10) || 0,
          users: parseInt(v[1].value, 10) || 0,
          newUsers: parseInt(v[2].value, 10) || 0,
          pageviews: parseInt(v[3].value, 10) || 0,
          bounceRate: parseFloat(v[4].value) || 0,
          avgSessionSec: parseFloat(v[5].value) || 0,
          engagedSessions: parseInt(v[6].value, 10) || 0,
          conversions: Math.round(parseFloat(v[7].value) || 0),
        },
        update: {
          sessions: parseInt(v[0].value, 10) || 0,
          users: parseInt(v[1].value, 10) || 0,
          newUsers: parseInt(v[2].value, 10) || 0,
          pageviews: parseInt(v[3].value, 10) || 0,
          bounceRate: parseFloat(v[4].value) || 0,
          avgSessionSec: parseFloat(v[5].value) || 0,
          engagedSessions: parseInt(v[6].value, 10) || 0,
          conversions: Math.round(parseFloat(v[7].value) || 0),
        },
      });
      snapshotsCount++;
    }

    // ─── 2. Top páginas/dia ─────────────────────────────────────────────────
    const pageRows = await runReport(integrationId, {
      propertyId,
      startDate,
      endDate,
      dimensions: ["date", "pagePath", "pageTitle"],
      metrics: ["screenPageViews", "totalUsers", "averageSessionDuration"],
      limit: 5000,
      orderBy: { metric: "screenPageViews", desc: true },
    });

    // Agrupa por dia → pega top 50 de cada
    const pagesByDay = new Map<string, RunReportRow[]>();
    for (const row of pageRows) {
      const date = row.dimensionValues[0].value;
      if (!pagesByDay.has(date)) pagesByDay.set(date, []);
      const arr = pagesByDay.get(date)!;
      if (arr.length < 50) arr.push(row);
    }

    // Limpa top pages antigas do range pra evitar páginas "fantasma"
    const earliestDate = parseGADate(
      Array.from(pagesByDay.keys()).sort()[0] ?? compactDate(daysAgo(daysBack))
    );
    await prisma.analyticsTopPage.deleteMany({
      where: { companyId: integ.companyId, source: "ga4", date: { gte: earliestDate } },
    });

    for (const [dateStr, rows] of pagesByDay) {
      const date = parseGADate(dateStr);
      for (const row of rows) {
        const pagePath = row.dimensionValues[1].value || "/";
        const pageTitle = row.dimensionValues[2]?.value || null;
        await prisma.analyticsTopPage.upsert({
          where: {
            companyId_date_source_pagePath: {
              companyId: integ.companyId,
              date,
              source: "ga4",
              pagePath,
            },
          },
          create: {
            companyId: integ.companyId,
            date,
            source: "ga4",
            pagePath,
            pageTitle,
            views: parseInt(row.metricValues[0].value, 10) || 0,
            users: parseInt(row.metricValues[1].value, 10) || 0,
            avgTimeSec: parseFloat(row.metricValues[2].value) || 0,
          },
          update: {
            pageTitle,
            views: parseInt(row.metricValues[0].value, 10) || 0,
            users: parseInt(row.metricValues[1].value, 10) || 0,
            avgTimeSec: parseFloat(row.metricValues[2].value) || 0,
          },
        });
        topPagesCount++;
      }
    }

    // ─── 3. Origens de tráfego (source/medium) ──────────────────────────────
    const trafficRows = await runReport(integrationId, {
      propertyId,
      startDate,
      endDate,
      dimensions: ["date", "sessionSource", "sessionMedium"],
      metrics: ["sessions", "totalUsers", "conversions"],
      limit: 5000,
    });

    // Limpa traffic antigo do range
    const trafficEarliest = trafficRows.length > 0
      ? parseGADate(trafficRows[0].dimensionValues[0].value)
      : parseGADate(compactDate(daysAgo(daysBack)));
    await prisma.analyticsTrafficSource.deleteMany({
      where: { companyId: integ.companyId, source: "ga4", date: { gte: trafficEarliest } },
    });

    for (const row of trafficRows) {
      const date = parseGADate(row.dimensionValues[0].value);
      const rawSource = row.dimensionValues[1].value || "(direct)";
      const rawMedium = row.dimensionValues[2].value || "(none)";
      const bucket = classifyTrafficSource({ source: rawSource, medium: rawMedium });

      await prisma.analyticsTrafficSource.upsert({
        where: {
          companyId_date_source_rawSource_rawMedium: {
            companyId: integ.companyId,
            date,
            source: "ga4",
            rawSource,
            rawMedium,
          },
        },
        create: {
          companyId: integ.companyId,
          date,
          source: "ga4",
          rawSource,
          rawMedium,
          bucket,
          sessions: parseInt(row.metricValues[0].value, 10) || 0,
          users: parseInt(row.metricValues[1].value, 10) || 0,
          conversions: Math.round(parseFloat(row.metricValues[2].value) || 0),
        },
        update: {
          bucket,
          sessions: parseInt(row.metricValues[0].value, 10) || 0,
          users: parseInt(row.metricValues[1].value, 10) || 0,
          conversions: Math.round(parseFloat(row.metricValues[2].value) || 0),
        },
      });
      trafficCount++;
    }

    // ─── 4. Geo (country/region/city) ───────────────────────────────────────
    const geoRows = await runReport(integrationId, {
      propertyId,
      startDate,
      endDate,
      dimensions: ["date", "country", "countryId", "region", "city"],
      metrics: ["sessions", "totalUsers"],
      limit: 5000,
    });

    const geoEarliest = geoRows.length > 0
      ? parseGADate(geoRows[0].dimensionValues[0].value)
      : parseGADate(compactDate(daysAgo(daysBack)));
    await prisma.analyticsGeoData.deleteMany({
      where: { companyId: integ.companyId, source: "ga4", date: { gte: geoEarliest } },
    });

    for (const row of geoRows) {
      const date = parseGADate(row.dimensionValues[0].value);
      const countryName = row.dimensionValues[1].value || null;
      const countryCode = row.dimensionValues[2].value || null; // ISO 3166-1 alpha-2
      const region = row.dimensionValues[3].value || null;
      const city = row.dimensionValues[4].value || null;

      await prisma.analyticsGeoData.upsert({
        where: {
          companyId_date_source_countryCode_region_city: {
            companyId: integ.companyId,
            date,
            source: "ga4",
            countryCode: countryCode ?? "",
            region: region ?? "",
            city: city ?? "",
          },
        },
        create: {
          companyId: integ.companyId,
          date,
          source: "ga4",
          countryCode,
          countryName,
          region,
          city,
          sessions: parseInt(row.metricValues[0].value, 10) || 0,
          users: parseInt(row.metricValues[1].value, 10) || 0,
        },
        update: {
          countryName,
          sessions: parseInt(row.metricValues[0].value, 10) || 0,
          users: parseInt(row.metricValues[1].value, 10) || 0,
        },
      });
      geoCount++;
    }

    // Marca como ok
    await prisma.marketingIntegration.update({
      where: { id: integrationId },
      data: { lastSyncAt: new Date(), lastSyncStatus: "ok", lastError: null, status: "ACTIVE" },
    });

    return { snapshots: snapshotsCount, topPages: topPagesCount, trafficSources: trafficCount, geoRows: geoCount };
  } catch (e: any) {
    await prisma.marketingIntegration.update({
      where: { id: integrationId },
      data: { lastSyncAt: new Date(), lastSyncStatus: `error`, lastError: e.message?.slice(0, 1000) ?? "erro desconhecido" },
    });
    throw e;
  }
}

// ─── Helpers de data ─────────────────────────────────────────────────────────

/** GA4 retorna data como "20260501" — converte pra Date UTC. */
function parseGADate(s: string): Date {
  const y = parseInt(s.slice(0, 4), 10);
  const m = parseInt(s.slice(4, 6), 10) - 1;
  const d = parseInt(s.slice(6, 8), 10);
  return new Date(Date.UTC(y, m, d));
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function compactDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
