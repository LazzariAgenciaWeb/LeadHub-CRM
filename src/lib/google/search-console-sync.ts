/**
 * Sincronização do Google Search Console (Search Analytics API).
 *
 * Estratégia:
 *   - Para cada dia do range, faz uma chamada agrupada por (date, query, page, country, device)
 *     limitando a 1000 linhas (rowLimit do GSC). Pega o top por cliques.
 *   - Salva em SearchConsoleQuery.
 *
 * Atenção: GSC tem ~3 dias de delay nos dados. Por isso pegamos até "today - 3".
 *
 * Docs: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 */

import { prisma } from "../prisma";
import { googleFetch } from "./token";

interface SearchAnalyticsRow {
  keys: string[];                  // ex: ["2026-04-30", "agencia marketing", "/pagina", "bra", "MOBILE"]
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface SearchAnalyticsResponse {
  rows?: SearchAnalyticsRow[];
}

export async function syncSearchConsole(integrationId: string, daysBack = 35): Promise<{
  queries: number;
  daysProcessed: number;
}> {
  const integ = await prisma.marketingIntegration.findUnique({
    where: { id: integrationId },
    select: { id: true, companyId: true, accountId: true, provider: true },
  });
  if (!integ) throw new Error("Integração não encontrada");
  if (integ.provider !== "SEARCH_CONSOLE") throw new Error("Integração não é Search Console");
  if (!integ.accountId) throw new Error("Selecione um site Search Console antes de sincronizar");

  const siteUrl = encodeURIComponent(integ.accountId);

  // GSC tem ~3 dias de delay. Pegamos de (daysBack+3) atrás até hoje-3.
  const today = new Date();
  const endDate = new Date(today);
  endDate.setUTCDate(endDate.getUTCDate() - 3);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - daysBack);

  const startStr = ymd(startDate);
  const endStr = ymd(endDate);

  let queriesCount = 0;
  let daysProcessed = 0;

  try {
    // Limpa registros antigos do range pra evitar entradas órfãs
    await prisma.searchConsoleQuery.deleteMany({
      where: {
        companyId: integ.companyId,
        date: { gte: startDate, lte: endDate },
      },
    });

    // GSC limita 25k rows/request. Usamos paginação por startRow.
    const pageSize = 5000;
    let startRow = 0;
    let safety = 0;

    while (true) {
      if (++safety > 20) break; // evita loop infinito

      const r = await googleFetch(
        integrationId,
        `https://searchconsole.googleapis.com/webmasters/v3/sites/${siteUrl}/searchAnalytics/query`,
        {
          method: "POST",
          body: JSON.stringify({
            startDate: startStr,
            endDate: endStr,
            dimensions: ["date", "query", "page", "country", "device"],
            rowLimit: pageSize,
            startRow,
            dataState: "all",
          }),
        }
      );

      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`Search Console falhou (${r.status}): ${txt.slice(0, 500)}`);
      }
      const data = (await r.json()) as SearchAnalyticsResponse;
      const rows = data.rows ?? [];
      if (rows.length === 0) break;

      const datesSeen = new Set<string>();
      for (const row of rows) {
        const [dateStr, query, page, country, device] = row.keys;
        datesSeen.add(dateStr);
        await prisma.searchConsoleQuery.create({
          data: {
            companyId: integ.companyId,
            date: new Date(dateStr + "T00:00:00.000Z"),
            query: query || "",
            page: page || null,
            country: country || null,
            device: device || null,
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
          },
        });
        queriesCount++;
      }
      daysProcessed = Math.max(daysProcessed, datesSeen.size);

      if (rows.length < pageSize) break;
      startRow += pageSize;
    }

    await prisma.marketingIntegration.update({
      where: { id: integrationId },
      data: { lastSyncAt: new Date(), lastSyncStatus: "ok", lastError: null, status: "ACTIVE" },
    });

    return { queries: queriesCount, daysProcessed };
  } catch (e: any) {
    await prisma.marketingIntegration.update({
      where: { id: integrationId },
      data: { lastSyncAt: new Date(), lastSyncStatus: `error`, lastError: e.message?.slice(0, 1000) ?? "erro desconhecido" },
    });
    throw e;
  }
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
