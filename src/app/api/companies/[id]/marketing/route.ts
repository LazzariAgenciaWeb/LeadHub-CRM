import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  SEARCH_EVENT_RE,
  SEARCH_TERM_PARAM_RE,
  SEARCH_FOUND_PARAM_RE,
  SEARCH_NO_RE,
  SITE_SEARCH_EVENT,
  SITE_SEARCH_MISS_EVENT,
} from "@/lib/google/ga4-sync";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { classifyTrafficSource, type TrafficBucket } from "@/lib/traffic-classifier";
import { assertModule } from "@/lib/billing";
import { resolveUf, ufName } from "@/lib/br-states";

// GET /api/companies/[id]/marketing?days=30&ga4=<integrationId>&sc=<integrationId>
//
// `ga4` e `sc` escolhem QUAL conexão ler quando a empresa tem mais de uma
// propriedade GA4 / site no Search Console. Omitido (ou "all") = consolidado:
// soma de todas as conexões daquele provider, inclusive o histórico de conexões
// já desconectadas. Id que não pertence à empresa cai no consolidado — e o
// campo `selected` da resposta diz o que foi REALMENTE usado, pra tela nunca
// mostrar um filtro que não foi aplicado.
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

  // ─── 0. Conexões da empresa + qual delas ler ─────────────────────────────
  const allIntegrations = await prisma.marketingIntegration.findMany({
    where: { companyId, provider: { in: ["GA4", "SEARCH_CONSOLE", "BUSINESS_PROFILE"] } },
    select: {
      id: true, provider: true, accountId: true, accountLabel: true, nickname: true,
      status: true, lastSyncAt: true, lastSyncStatus: true, createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Só conexão com propriedade escolhida entra no seletor — as pendentes não
  // têm dado nenhum e só confundiriam a lista.
  const sourcesFor = (provider: string) =>
    allIntegrations
      .filter((i) => i.provider === provider && i.accountId)
      .map((i) => ({
        id: i.id,
        label: i.nickname || i.accountLabel || i.accountId || "(sem nome)",
        accountId: i.accountId,
        accountLabel: i.accountLabel,
        nickname: i.nickname,
        status: i.status,
        lastSyncAt: i.lastSyncAt,
      }));

  const sources = {
    ga4: sourcesFor("GA4"),
    sc: sourcesFor("SEARCH_CONSOLE"),
    gbp: sourcesFor("BUSINESS_PROFILE"),
  };

  /**
   * Resolve o parâmetro num filtro de Prisma. Id desconhecido vira consolidado
   * em vez de erro: link antigo/salvo continua abrindo, só que sem filtro — e o
   * `selected` da resposta conta a verdade pra UI não mentir sobre o recorte.
   */
  function resolveSource(param: string | null, lista: { id: string }[]) {
    if (!param || param === "all") return { selected: "all" as const, where: {} };
    const achou = lista.some((s) => s.id === param);
    if (!achou) return { selected: "all" as const, where: {} };
    return { selected: param, where: { integrationId: param } };
  }

  const ga4Sel = resolveSource(url.searchParams.get("ga4"), sources.ga4);
  const scSel = resolveSource(url.searchParams.get("sc"), sources.sc);
  const ga4Where = ga4Sel.where; // {} = todas as propriedades (consolidado)
  const scWhere = scSel.where;

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
  const [snapsCurrent, snapsPrev, snapRows] = await Promise.all([
    prisma.analyticsSnapshot.aggregate({
      where: {
        companyId,
        ...ga4Where,
        source: "ga4",
        date: { gte: periodStart, lte: periodEnd },
      },
      _sum: { sessions: true, users: true, newUsers: true, pageviews: true, conversions: true, engagedSessions: true },
    }),
    prisma.analyticsSnapshot.aggregate({
      where: {
        companyId,
        ...ga4Where,
        source: "ga4",
        date: { gte: prevStart, lte: prevEnd },
      },
      _sum: { sessions: true, users: true, conversions: true },
    }),
    prisma.analyticsSnapshot.findMany({
      where: {
        companyId,
        ...ga4Where,
        source: "ga4",
        date: { gte: periodStart, lte: periodEnd },
      },
      select: {
        date: true, sessions: true, users: true, conversions: true, pageviews: true,
        bounceRate: true, avgSessionSec: true,
      },
      orderBy: { date: "asc" },
    }),
  ]);

  // Taxa de rejeição e duração média são MÉDIAS — não somam. Antes vinham do
  // `_avg` do banco, que faz média simples das linhas: com 1 propriedade isso
  // já dava peso igual a um domingo de 3 sessões e uma segunda de 900; com 2
  // propriedades passaria a misturar sites de portes diferentes na mesma conta.
  // Média ponderada por sessões é o número que o GA4 mostraria.
  let pesoSessoes = 0;
  let somaBounce = 0;
  let somaDuracao = 0;
  for (const r of snapRows) {
    const peso = r.sessions || 0;
    if (peso <= 0) continue;
    pesoSessoes += peso;
    somaBounce += (r.bounceRate ?? 0) * peso;
    somaDuracao += (r.avgSessionSec ?? 0) * peso;
  }
  const bounceRateMedia = pesoSessoes > 0 ? somaBounce / pesoSessoes : 0;
  const avgSessionSecMedia = pesoSessoes > 0 ? somaDuracao / pesoSessoes : 0;

  // Uma linha por (dia, propriedade) — no consolidado o mesmo dia aparece N
  // vezes. Sem agrupar, o gráfico repetiria a data e desenharia degrau.
  const serieMap = new Map<string, { sessions: number; users: number; pageviews: number }>();
  for (const r of snapRows) {
    const key = r.date.toISOString().slice(0, 10);
    const slot = serieMap.get(key) ?? { sessions: 0, users: 0, pageviews: 0 };
    slot.sessions += r.sessions;
    slot.users += r.users;
    slot.pageviews += r.pageviews;
    serieMap.set(key, slot);
  }

  // ─── 2. Origens (traffic sources) — agrega por bucket ────────────────────
  const trafficRows = await prisma.analyticsTrafficSource.findMany({
    where: {
      companyId,
      ...ga4Where,
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
      ...ga4Where,
      source: "ga4",
      date: { gte: periodStart, lte: periodEnd },
    },
    // No consolidado, "/" de dois sites diferentes vira a mesma linha. É a
    // leitura certa pra "páginas mais vistas da empresa"; quem precisa saber de
    // qual site troca o seletor pra propriedade específica.
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
      ...ga4Where,
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
      where: { companyId, ...scWhere, date: { gte: periodStart, lte: periodEnd } },
      select: { query: true, clicks: true, impressions: true, ctr: true, position: true },
    }),
    prisma.searchConsoleQuery.findMany({
      where: { companyId, ...scWhere, date: { gte: prevStart, lte: prevEnd } },
      select: { query: true, clicks: true, impressions: true, position: true },
    }),
  ]);

  // Posição média ponderada por impressões — é assim que o próprio Search
  // Console calcula. A média simples das linhas dava o mesmo peso a um dia com
  // 2 impressões e outro com 2 mil, e no consolidado passaria a misturar dois
  // sites de portes diferentes.
  const mediaPonderada = (linhas: { position: number; impressions: number }[]): number | null => {
    let peso = 0;
    let soma = 0;
    for (const l of linhas) {
      const p = l.impressions || 0;
      if (p <= 0) continue;
      peso += p;
      soma += l.position * p;
    }
    return peso > 0 ? soma / peso : null;
  };

  // Indexa período anterior por query → posição ponderada (pra delta)
  const prevPositionByQuery = new Map<string, number>();
  const prevTmp = new Map<string, { position: number; impressions: number }[]>();
  for (const q of scPrevRows) {
    if (!prevTmp.has(q.query)) prevTmp.set(q.query, []);
    prevTmp.get(q.query)!.push({ position: q.position, impressions: q.impressions });
  }
  for (const [query, linhas] of prevTmp) {
    const m = mediaPonderada(linhas);
    if (m !== null) prevPositionByQuery.set(query, m);
  }

  const queriesMap = new Map<string, { clicks: number; impressions: number; linhas: { position: number; impressions: number }[] }>();
  for (const q of scRows) {
    if (!queriesMap.has(q.query)) {
      queriesMap.set(q.query, { clicks: 0, impressions: 0, linhas: [] });
    }
    const slot = queriesMap.get(q.query)!;
    slot.clicks += q.clicks;
    slot.impressions += q.impressions;
    slot.linhas.push({ position: q.position, impressions: q.impressions });
  }
  const topQueries = Array.from(queriesMap.entries())
    .map(([query, v]) => {
      const position = mediaPonderada(v.linhas) ?? 0;
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
      where: { companyId, ...ga4Where, source: "ga4", date: { gte: periodStart, lte: periodEnd } },
      _sum: { eventCount: true, users: true },
    }),
    // Config continua por empresa (não por conexão) — ver nota no schema:
    // com 2 propriedades o nome do evento costuma ser o mesmo nas duas, e
    // marcar conversão duas vezes seria só atrito.
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
        featured: cfg?.featured ?? false,
        hidden: cfg?.hidden ?? false,
      };
    })
    .sort((a, b) => b.count - a.count);

  const conversionsLeadHub = events
    .filter((e) => e.isConversion)
    .reduce((sum, e) => sum + e.count, 0);

  const conversionEvents = events.filter((e) => e.isConversion);

  // Eventos em destaque: o que o cliente quer ver de cara na listagem/relatório
  // (ex.: acesso a página, clique no WhatsApp, pedido de catálogo). Conversões
  // entram por padrão enquanto ninguém marcar destaque nenhum.
  const featuredEvents = events.some((e) => e.featured)
    ? events.filter((e) => e.featured)
    : conversionEvents;

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
          ...ga4Where,
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
          ...ga4Where,
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
          ...ga4Where,
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
          // Lista inteira (limite de sanidade): o bloco mostra o topo, o
          // relatório detalhado no modal mostra tudo.
          values: values.sort((a, b) => b.count - a.count).slice(0, 300),
        }))
        .sort((a, b) => a.paramName.localeCompare(b.paramName)),
    }));
  }

  // ─── 6b. Busca interna do site ───────────────────────────────────────────
  // Fontes: a dimensão nativa searchTerm (medição avançada) e os parâmetros
  // personalizados do evento próprio — ex.: view_search_results com search_term
  // (o que digitaram) + search_encontrou (sim/nao). Independe de o evento estar
  // marcado como conversão. Manda a lista inteira: o relatório detalhado abre
  // num modal e precisa de tudo, não só do topo.
  const YES_RE = /^(sim|yes|true|1)$/i;

  const searchEventNames = events.map((e) => e.eventName).filter((n) => SEARCH_EVENT_RE.test(n));
  const searchRows = await prisma.analyticsEventParamDaily.groupBy({
    by: ["eventName", "paramName", "paramValue"],
    where: {
      companyId,
      ...ga4Where,
      source: "ga4",
      date: { gte: periodStart, lte: periodEnd },
      eventName: { in: [SITE_SEARCH_EVENT, SITE_SEARCH_MISS_EVENT, ...searchEventNames] },
    },
    _sum: { eventCount: true, users: true },
  });

  type TermAgg = { term: string; count: number; users: number };
  const sumByTerm = (rows: typeof searchRows): TermAgg[] => {
    const acc = new Map<string, TermAgg>();
    for (const row of rows) {
      const key = row.paramValue.trim().toLowerCase();
      if (!key) continue;
      const cur = acc.get(key) ?? { term: row.paramValue.trim(), count: 0, users: 0 };
      cur.count += row._sum.eventCount ?? 0;
      cur.users += row._sum.users ?? 0;
      acc.set(key, cur);
    }
    return Array.from(acc.values()).sort((a, b) => b.count - a.count);
  };

  // Termos buscados: dimensão nativa + parâmetro próprio, somados pelo texto
  // (o mesmo termo pode chegar pelos dois caminhos).
  const allTerms = sumByTerm(
    searchRows.filter(
      (r) =>
        r.eventName === SITE_SEARCH_EVENT ||
        (r.eventName !== SITE_SEARCH_MISS_EVENT && SEARCH_TERM_PARAM_RE.test(r.paramName))
    )
  );

  // Termos que não acharam nada — vem do cruzamento feito no sync.
  const missTerms = sumByTerm(searchRows.filter((r) => r.eventName === SITE_SEARCH_MISS_EVENT));

  // Total de buscas com/sem resultado (parâmetro "encontrou", sem cruzamento).
  let searchFound = 0;
  let searchNotFound = 0;
  for (const row of searchRows) {
    if (row.eventName === SITE_SEARCH_MISS_EVENT) continue;
    if (!SEARCH_FOUND_PARAM_RE.test(row.paramName)) continue;
    const v = row.paramValue.trim();
    if (SEARCH_NO_RE.test(v)) searchNotFound += row._sum.eventCount ?? 0;
    else if (YES_RE.test(v)) searchFound += row._sum.eventCount ?? 0;
  }
  // Sem o parâmetro "encontrou", o cruzamento ainda dá o total de falhas.
  if (searchNotFound === 0) searchNotFound = missTerms.reduce((sum, t) => sum + t.count, 0);

  const siteSearch = {
    total: allTerms.reduce((sum, t) => sum + t.count, 0),
    distinct: allTerms.length,
    found: searchFound,
    notFound: searchNotFound,
    terms: allTerms.slice(0, 300),
    missTerms: missTerms.slice(0, 300),
  };

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
  // Reflete o RECORTE em tela: com uma propriedade escolhida, mostra o sync
  // dela; no consolidado, o mais ANTIGO entre as ativas — "atualizado até" só é
  // verdade se valer pra todas, senão o rodapé prometeria dado mais fresco do
  // que o relatório tem.
  const statusDoRecorte = (provider: string, selecionado: string) => {
    const doProvider = allIntegrations.filter((i) => i.provider === provider && i.accountId);
    if (doProvider.length === 0) return null;
    if (selecionado !== "all") {
      return doProvider.find((i) => i.id === selecionado) ?? null;
    }
    const comSync = doProvider.filter((i) => i.lastSyncAt);
    if (comSync.length === 0) return doProvider[0];
    return comSync.reduce((maisAntigo, i) =>
      i.lastSyncAt! < maisAntigo.lastSyncAt! ? i : maisAntigo
    );
  };
  const integrationStatus = {
    ga4: statusDoRecorte("GA4", ga4Sel.selected),
    sc: statusDoRecorte("SEARCH_CONSOLE", scSel.selected),
    // GBP tem endpoint próprio (marketing/gbp) com seletor próprio; aqui só o
    // status pro cabeçalho.
    gbp: statusDoRecorte("BUSINESS_PROFILE", "all"),
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
      bounceRate:  { value: bounceRateMedia },
      avgSessionSec: { value: avgSessionSecMedia },
      engagedSessions: { value: snapsCurrent._sum.engagedSessions ?? 0 },
    },
    dailySeries: Array.from(serieMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, d]) => ({
        date: dateKey,
        sessions: d.sessions,
        users: d.users,
        // Conversões diárias derivadas dos eventos marcados como conversão no LeadHub
        // (cai pra 0 nos dias sem eventos marcados — não usa mais d.conversions nativa do GA4).
        conversions: conversionsByDay.get(dateKey) ?? 0,
        pageviews: d.pageviews,
      })),
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
    featuredEvents,
    conversionParams,
    siteSearch,
    funnel,
    integrationStatus,
    // Conexões disponíveis + qual recorte foi aplicado de fato. A tela usa isso
    // pra montar o seletor de propriedade — e só o mostra quando há mais de uma.
    sources,
    selected: { ga4: ga4Sel.selected, sc: scSel.selected },
    hasData: (snapsCurrent._sum.sessions ?? 0) > 0 || scRows.length > 0,
  });
}
