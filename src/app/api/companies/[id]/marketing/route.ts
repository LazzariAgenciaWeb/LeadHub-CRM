import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { classifyTrafficSource, type TrafficBucket } from "@/lib/traffic-classifier";
import { assertModule } from "@/lib/billing";
import { resolveUf, ufName } from "@/lib/br-states";

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

  // fix A3 — gate de módulo marketing (feature do plano)
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "marketing");
  if (!gate.ok) return gate.response;

  // checkCofreModule: false — Marketing já gateou via assertModule("marketing") acima.
  // authorizeVaultAccess é só pra validar acesso à empresa-alvo (e ler tokens das
  // integrações do Google). Sem este flag, endpoint exigia plano com Cofre, gerando
  // "Cofre não disponível no plano" em planos que têm Marketing mas não Cofre.
  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
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
      select: { date: true, sessions: true, users: true, conversions: true, pageviews: true },
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
  // Filtros GA4: "(not set)" / "(not provided)" são lixo do GA4 quando ele
  // não conseguiu determinar o dado. Aplicar aqui também (não só no sync)
  // pra cobrir dados antigos já gravados antes do filtro entrar no ga4-sync.
  const isReal = (v: string | null | undefined): v is string =>
    !!v && v !== "(not set)" && v !== "(not provided)" && v !== "(other)";

  let geoStatsTotalRows = 0;
  let geoStatsWithCity = 0;
  let geoStatsNotSetCount = 0;

  // Agregado por UF brasileira (alimenta o overlay do mapa do Brasil).
  // Chave: sigla UF; valor: sessões + users + lista de cidades.
  const brStatesMap = new Map<string, { uf: string; name: string; sessions: number; users: number; cities: Map<string, { sessions: number; users: number }> }>();

  const countriesMap = new Map<string, { code: string; name: string; sessions: number; users: number; cities: Map<string, { sessions: number; users: number; region: string | null }> }>();
  for (const g of geoRaw) {
    geoStatsTotalRows++;
    const code = isReal(g.countryCode) ? g.countryCode : "??";
    const name = g.countryName || "Desconhecido";
    if (!countriesMap.has(code)) {
      countriesMap.set(code, { code, name, sessions: 0, users: 0, cities: new Map() });
    }
    const c = countriesMap.get(code)!;
    c.sessions += g.sessions;
    c.users += g.users;
    if (isReal(g.city)) {
      geoStatsWithCity++;
      if (!c.cities.has(g.city)) {
        c.cities.set(g.city, { sessions: 0, users: 0, region: isReal(g.region) ? g.region : null });
      }
      const ct = c.cities.get(g.city)!;
      ct.sessions += g.sessions;
      ct.users += g.users;
    } else if (g.city) {
      geoStatsNotSetCount++;
    }

    // Agregação por UF brasileira (independente de city ter ou não vindo)
    if (code === "BR" && isReal(g.region)) {
      const uf = resolveUf(g.region);
      if (uf) {
        if (!brStatesMap.has(uf)) {
          brStatesMap.set(uf, { uf, name: ufName(uf), sessions: 0, users: 0, cities: new Map() });
        }
        const st = brStatesMap.get(uf)!;
        st.sessions += g.sessions;
        st.users += g.users;
        if (isReal(g.city)) {
          if (!st.cities.has(g.city)) st.cities.set(g.city, { sessions: 0, users: 0 });
          const stCt = st.cities.get(g.city)!;
          stCt.sessions += g.sessions;
          stCt.users += g.users;
        }
      }
    }
  }

  const brazilStates = Array.from(brStatesMap.values())
    .map((s) => ({
      uf: s.uf,
      name: s.name,
      sessions: s.sessions,
      users: s.users,
      cityCount: s.cities.size,
      topCities: Array.from(s.cities.entries())
        .map(([city, v]) => ({ city, sessions: v.sessions, users: v.users }))
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 5),
    }))
    .sort((a, b) => b.sessions - a.sessions);
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

  // ─── 5. Search Console — top queries (atual + período anterior) ─────────
  // Busca em paralelo: período corrente e período imediatamente anterior
  // (mesmo número de dias). Usado pra mostrar variação de posição.
  const [scRows, scPrevRows] = await Promise.all([
    prisma.searchConsoleQuery.findMany({
      where: { companyId, date: { gte: periodStart, lte: periodEnd } },
      select: { query: true, clicks: true, impressions: true, ctr: true, position: true },
    }),
    prisma.searchConsoleQuery.findMany({
      where: { companyId, date: { gte: prevStart, lte: prevEnd } },
      select: { query: true, clicks: true, impressions: true, position: true },
    }),
  ]);

  // Indexa período anterior por query → média de posição (pra delta)
  const prevPositionByQuery = new Map<string, number>();
  const prevTmp = new Map<string, { positions: number[]; clicks: number }>();
  for (const q of scPrevRows) {
    if (!prevTmp.has(q.query)) prevTmp.set(q.query, { positions: [], clicks: 0 });
    const slot = prevTmp.get(q.query)!;
    slot.positions.push(q.position);
    slot.clicks += q.clicks;
  }
  for (const [query, v] of prevTmp) {
    if (v.positions.length > 0) {
      prevPositionByQuery.set(query, v.positions.reduce((a, b) => a + b, 0) / v.positions.length);
    }
  }

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
    .map(([query, v]) => {
      const position = v.positions.length > 0 ? v.positions.reduce((a, b) => a + b, 0) / v.positions.length : 0;
      const prevPosition = prevPositionByQuery.get(query) ?? null;
      // Delta positivo = melhorou (subiu na busca, posição diminuiu)
      const positionDelta = prevPosition !== null ? prevPosition - position : null;
      return {
        query,
        clicks: v.clicks,
        impressions: v.impressions,
        ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
        position,
        prevPosition,
        positionDelta,
      };
    })
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 30);

  const scTotal = scRows.reduce(
    (acc, r) => ({ clicks: acc.clicks + r.clicks, impressions: acc.impressions + r.impressions }),
    { clicks: 0, impressions: 0 }
  );

  // ─── 6. Eventos + config (conversões LeadHub) ───────────────────────────
  // O sync popula AnalyticsEventDaily com TODOS os eventos. A config diz
  // quais contam como conversão pelo critério do cliente do LeadHub —
  // independente do que o admin do GA4 marcou como key event.
  const [eventAggRows, eventConfigs] = await Promise.all([
    prisma.analyticsEventDaily.groupBy({
      by: ["eventName"],
      where: { companyId, source: "ga4", date: { gte: periodStart, lte: periodEnd } },
      _sum: { eventCount: true, users: true },
    }),
    prisma.marketingEventConfig.findMany({ where: { companyId, source: "ga4" } }),
  ]);
  const configByName = new Map(eventConfigs.map((c) => [c.eventName, c]));

  const events = eventAggRows
    .map((r) => {
      const cfg = configByName.get(r.eventName);
      return {
        eventName: r.eventName,
        label: cfg?.displayLabel || r.eventName,
        count: r._sum.eventCount ?? 0,
        users: r._sum.users ?? 0,
        isConversion: cfg?.isConversion ?? false,
        hidden: cfg?.hidden ?? false,
      };
    })
    .sort((a, b) => b.count - a.count);

  const conversionsLeadHub = events
    .filter((e) => e.isConversion)
    .reduce((sum, e) => sum + e.count, 0);

  const conversionEvents = events.filter((e) => e.isConversion);

  // Nomes dos eventos marcados como conversão — usados pra (a) calcular o total
  // do período anterior (delta) e (b) montar série diária pro gráfico de tráfego.
  const conversionEventNames = eventConfigs
    .filter((c) => c.isConversion)
    .map((c) => c.eventName);

  // Conversões LeadHub do período anterior — pra mostrar delta no card.
  let conversionsLeadHubPrev = 0;
  // Série diária de conversões LeadHub (data → contagem somada dos eventos marcados).
  const conversionsByDay = new Map<string, number>();

  // Detalhamento por parâmetro personalizado (customEvent: sincronizado pelo ga4-sync):
  // [{ eventName, params: [{ paramName, values: [{ value, count, users }] }] }]
  type ParamValueAgg = { value: string; count: number; users: number };
  type ConversionParams = { eventName: string; params: { paramName: string; values: ParamValueAgg[] }[] };
  let conversionParams: ConversionParams[] = [];

  if (conversionEventNames.length > 0) {
    const [prevAgg, dailyAgg, paramAggRows] = await Promise.all([
      prisma.analyticsEventDaily.aggregate({
        where: {
          companyId,
          source: "ga4",
          date: { gte: prevStart, lte: prevEnd },
          eventName: { in: conversionEventNames },
        },
        _sum: { eventCount: true },
      }),
      prisma.analyticsEventDaily.groupBy({
        by: ["date"],
        where: {
          companyId,
          source: "ga4",
          date: { gte: periodStart, lte: periodEnd },
          eventName: { in: conversionEventNames },
        },
        _sum: { eventCount: true },
      }),
      prisma.analyticsEventParamDaily.groupBy({
        by: ["eventName", "paramName", "paramValue"],
        where: {
          companyId,
          source: "ga4",
          date: { gte: periodStart, lte: periodEnd },
          eventName: { in: conversionEventNames },
        },
        _sum: { eventCount: true, users: true },
      }),
    ]);
    conversionsLeadHubPrev = prevAgg._sum.eventCount ?? 0;
    for (const row of dailyAgg) {
      const key = row.date.toISOString().slice(0, 10);
      conversionsByDay.set(key, row._sum.eventCount ?? 0);
    }

    // eventName → paramName → valores agregados no período
    const byEvent = new Map<string, Map<string, ParamValueAgg[]>>();
    for (const row of paramAggRows) {
      if (!byEvent.has(row.eventName)) byEvent.set(row.eventName, new Map());
      const byParam = byEvent.get(row.eventName)!;
      if (!byParam.has(row.paramName)) byParam.set(row.paramName, []);
      byParam.get(row.paramName)!.push({
        value: row.paramValue,
        count: row._sum.eventCount ?? 0,
        users: row._sum.users ?? 0,
      });
    }
    conversionParams = Array.from(byEvent.entries()).map(([eventName, byParam]) => ({
      eventName,
      params: Array.from(byParam.entries())
        .map(([paramName, values]) => ({
          paramName,
          values: values.sort((a, b) => b.count - a.count).slice(0, 10),
        }))
        .sort((a, b) => a.paramName.localeCompare(b.paramName)),
    }));
  }

  // ─── 7. Funil adaptativo + Ganho/Perdido ────────────────────────────────
  // Perfil detectado pelos módulos contratados:
  //   básico   = só Marketing                       → 3 estágios
  //   captação = Marketing + Prospecção             → 4 estágios
  //   completo = Marketing + Prospecção + Oportun.  → 6 estágios + Ganho/Perdido
  const companyForFunnel = await prisma.company.findUnique({
    where: { id: companyId },
    select: { moduleProspeccao: true, moduleCrm: true },
  });

  // Sub-pipeline Oportunidades vem de PlanFeatures (não flag direta) — reusa o
  // mesmo loader que o effective-session faz. Tolerante a empresa sem plano.
  let hasOportunidades = false;
  try {
    const { getCompanyPlan } = await import("@/lib/limits");
    const ctx = await getCompanyPlan(companyId);
    hasOportunidades = ctx.effectiveFeatures.crmPipelineOportunidades;
  } catch {
    // sem subscription / loader falhou → assume sem
  }

  const hasProspeccao = (companyForFunnel?.moduleProspeccao ?? false) || (companyForFunnel?.moduleCrm ?? false);

  // Leads contados no período corrente
  const [leadsTotal, leadsWon, leadsLost] = await Promise.all([
    prisma.lead.count({ where: { companyId, createdAt: { gte: periodStart, lte: periodEnd } } }),
    prisma.lead.count({ where: { companyId, status: "CLOSED", updatedAt: { gte: periodStart, lte: periodEnd } } }),
    prisma.lead.count({ where: { companyId, status: "LOST", updatedAt: { gte: periodStart, lte: periodEnd } } }),
  ]);

  // Oportunidades = leads no pipeline "OPORTUNIDADES" (modelo Lead com `pipeline`)
  let opsCount = 0;
  if (hasOportunidades) {
    opsCount = await prisma.lead.count({
      where: { companyId, pipeline: "OPORTUNIDADES", createdAt: { gte: periodStart, lte: periodEnd } },
    });
  }

  type FunnelStage = { key: string; label: string; value: number };
  const stages: FunnelStage[] = [
    { key: "sessions", label: "Sessões", value: snapsCurrent._sum.sessions ?? 0 },
    { key: "users", label: "Usuários", value: snapsCurrent._sum.users ?? 0 },
    { key: "conversions", label: "Eventos de conversão", value: conversionsLeadHub },
  ];
  let profile: "basico" | "captacao" | "completo" = "basico";
  if (hasProspeccao) {
    stages.push({ key: "leads", label: "Leads no CRM", value: leadsTotal });
    profile = "captacao";
  }
  if (hasOportunidades) {
    stages.push({ key: "oportunidades", label: "Oportunidades", value: opsCount });
    profile = "completo";
  }

  const funnel = {
    profile,
    stages,
    won: hasOportunidades || hasProspeccao ? leadsWon : null,
    lost: hasOportunidades || hasProspeccao ? leadsLost : null,
  };

  // ─── 8. Status das integrações (pra UI mostrar lastSync por bloco) ──────
  const integStatusRows = await prisma.marketingIntegration.findMany({
    where: { companyId, provider: { in: ["GA4", "SEARCH_CONSOLE", "BUSINESS_PROFILE"] } },
    select: { provider: true, status: true, lastSyncAt: true, lastSyncStatus: true, accountId: true, accountLabel: true },
  });
  const integrationStatus = {
    ga4: integStatusRows.find((i) => i.provider === "GA4") ?? null,
    sc:  integStatusRows.find((i) => i.provider === "SEARCH_CONSOLE") ?? null,
    gbp: integStatusRows.find((i) => i.provider === "BUSINESS_PROFILE") ?? null,
  };

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
      // Conversões = soma dos eventos marcados como conversão no LeadHub.
      // Quem não marcou nada vê 0 (com hint na UI pra configurar). Delta vs período anterior.
      conversions: { value: conversionsLeadHub, delta: pct(conversionsLeadHub, conversionsLeadHubPrev) },
      pageviews:   { value: snapsCurrent._sum.pageviews ?? 0 },
      newUsers:    { value: snapsCurrent._sum.newUsers ?? 0 },
      bounceRate:  { value: snapsCurrent._avg.bounceRate ?? 0 },
      avgSessionSec: { value: snapsCurrent._avg.avgSessionSec ?? 0 },
      engagedSessions: { value: snapsCurrent._sum.engagedSessions ?? 0 },
    },
    dailySeries: dailySeries.map((d) => {
      const dateKey = d.date.toISOString().slice(0, 10);
      return {
        date: dateKey,
        sessions: d.sessions,
        users: d.users,
        // Conversões diárias derivadas dos eventos marcados como conversão no LeadHub
        // (cai pra 0 nos dias sem eventos marcados — não usa mais d.conversions nativa do GA4).
        conversions: conversionsByDay.get(dateKey) ?? 0,
        pageviews: d.pageviews,
      };
    }),
    trafficBuckets,
    topPages,
    countries,
    brazilStates,
    geoStats: {
      // Diagnóstico: quantas linhas o GA4 entregou e quantas tinham cidade real.
      // Diego pode ver se "cidades sumiram" é falta de dado vs lixo do GA4.
      totalRows: geoStatsTotalRows,
      withCity: geoStatsWithCity,
      notSetCount: geoStatsNotSetCount,
    },
    topQueries,
    searchConsole: {
      totalClicks: scTotal.clicks,
      totalImpressions: scTotal.impressions,
      avgCtr: scTotal.impressions > 0 ? scTotal.clicks / scTotal.impressions : 0,
    },
    events,
    conversionEvents,
    conversionsLeadHub,
    conversionParams,
    funnel,
    integrationStatus,
    hasData: (snapsCurrent._sum.sessions ?? 0) > 0 || scRows.length > 0,
  });
}
