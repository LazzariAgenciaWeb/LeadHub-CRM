import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { assertModule } from "@/lib/billing";
import { classifyScProperty, isScPlatformProperty } from "@/lib/search-console-property";

// GET /api/companies/[id]/marketing/search-console?days=30
//
// Desempenho das PROPRIEDADES DE PLATAFORMA do Search Console — o perfil do
// Instagram, do TikTok, do X e o canal do YouTube na Busca do Google e no
// Discover. Alimenta a aba "Redes" do Dashboard de Marketing.
//
// Devolve todos os canais conectados num round-trip: são no máximo um punhado
// de perfis por empresa, e a tela mostra os blocos um embaixo do outro.
//
// O que NÃO é: métrica de dentro da rede (alcance, seguidores, views). Essas
// só saem da API da própria rede — aqui é o que o Google mostra na busca.
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

  // Só conexão com propriedade escolhida tem dado — pendente não entra.
  const conexoes = (
    await prisma.marketingIntegration.findMany({
      where: { companyId, provider: "SEARCH_CONSOLE" },
      select: {
        id: true, accountId: true, accountLabel: true, nickname: true,
        status: true, lastSyncAt: true, lastSyncStatus: true, lastError: true,
      },
      orderBy: { createdAt: "asc" },
    })
  ).filter((i) => i.accountId && isScPlatformProperty(i.accountId));

  if (conexoes.length === 0) {
    return NextResponse.json({ connected: false, period: { days }, channels: [] });
  }

  const ids = conexoes.map((i) => i.id);
  const [rows, prevRows] = await Promise.all([
    prisma.searchConsoleQuery.findMany({
      where: { companyId, integrationId: { in: ids }, date: { gte: periodStart, lte: periodEnd } },
      select: {
        integrationId: true, date: true, query: true, page: true,
        clicks: true, impressions: true, position: true,
      },
    }),
    prisma.searchConsoleQuery.findMany({
      where: { companyId, integrationId: { in: ids }, date: { gte: prevStart, lte: prevEnd } },
      select: { integrationId: true, clicks: true, impressions: true, position: true },
    }),
  ]);

  /**
   * Posição média ponderada por impressões — é como o próprio Search Console
   * calcula. Média simples daria o mesmo peso a um dia com 2 impressões e a
   * outro com 2 mil.
   */
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

  const pct = (curr: number, prev: number): number | null => {
    if (prev === 0) return curr > 0 ? 100 : null;
    return ((curr - prev) / prev) * 100;
  };

  type Agg = {
    clicks: number;
    impressions: number;
    linhas: { position: number; impressions: number }[];
  };
  const novoAgg = (): Agg => ({ clicks: 0, impressions: 0, linhas: [] });
  const soma = (a: Agg, r: { clicks: number; impressions: number; position: number }) => {
    a.clicks += r.clicks;
    a.impressions += r.impressions;
    a.linhas.push({ position: r.position, impressions: r.impressions });
  };

  const porIntegracao = new Map<string, {
    total: Agg;
    queries: Map<string, Agg>;
    pages: Map<string, Agg>;
    dias: Map<string, { clicks: number; impressions: number }>;
  }>();
  for (const id of ids) {
    porIntegracao.set(id, { total: novoAgg(), queries: new Map(), pages: new Map(), dias: new Map() });
  }

  for (const r of rows) {
    const slot = porIntegracao.get(r.integrationId);
    if (!slot) continue;
    soma(slot.total, r);

    if (!slot.queries.has(r.query)) slot.queries.set(r.query, novoAgg());
    soma(slot.queries.get(r.query)!, r);

    // Em propriedade de plataforma, `page` é o post/vídeo que apareceu na busca.
    if (r.page) {
      if (!slot.pages.has(r.page)) slot.pages.set(r.page, novoAgg());
      soma(slot.pages.get(r.page)!, r);
    }

    const dia = r.date.toISOString().slice(0, 10);
    const d = slot.dias.get(dia) ?? { clicks: 0, impressions: 0 };
    d.clicks += r.clicks;
    d.impressions += r.impressions;
    slot.dias.set(dia, d);
  }

  const prevPorIntegracao = new Map<string, Agg>();
  for (const id of ids) prevPorIntegracao.set(id, novoAgg());
  for (const r of prevRows) {
    const a = prevPorIntegracao.get(r.integrationId);
    if (a) soma(a, r);
  }

  const topDe = (m: Map<string, Agg>, limite: number) =>
    Array.from(m.entries())
      .map(([key, v]) => ({
        key,
        clicks: v.clicks,
        impressions: v.impressions,
        ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
        position: mediaPonderada(v.linhas) ?? 0,
      }))
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
      .slice(0, limite);

  const channels = conexoes.map((i) => {
    const info = classifyScProperty(i.accountId);
    const slot = porIntegracao.get(i.id)!;
    const prev = prevPorIntegracao.get(i.id)!;
    const position = mediaPonderada(slot.total.linhas);
    const prevPosition = mediaPonderada(prev.linhas);

    return {
      integrationId: i.id,
      channel: info.channel,
      handle: info.handle,
      label: i.nickname || info.label,
      property: i.accountId,
      status: i.status,
      lastSyncAt: i.lastSyncAt,
      lastSyncStatus: i.lastSyncStatus,
      lastError: i.lastError,
      kpis: {
        clicks:      { value: slot.total.clicks,      delta: pct(slot.total.clicks, prev.clicks) },
        impressions: { value: slot.total.impressions, delta: pct(slot.total.impressions, prev.impressions) },
        ctr: {
          value: slot.total.impressions > 0 ? slot.total.clicks / slot.total.impressions : 0,
          previous: prev.impressions > 0 ? prev.clicks / prev.impressions : null,
        },
        position: {
          value: position,
          previous: prevPosition,
          // Positivo = melhorou (subiu na busca, posição diminuiu).
          delta: position !== null && prevPosition !== null ? prevPosition - position : null,
        },
      },
      dailySeries: Array.from(slot.dias.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, d]) => ({ date, clicks: d.clicks, impressions: d.impressions })),
      topQueries: topDe(slot.queries, 20).map(({ key, ...rest }) => ({ query: key, ...rest })),
      topPages: topDe(slot.pages, 10).map(({ key, ...rest }) => ({ page: key, ...rest })),
    };
  });

  return NextResponse.json({
    connected: true,
    period: {
      days,
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      prevStart: prevStart.toISOString(),
      prevEnd: prevEnd.toISOString(),
    },
    channels,
    hasData: channels.some((c) => c.kpis.impressions.value > 0),
  });
}
