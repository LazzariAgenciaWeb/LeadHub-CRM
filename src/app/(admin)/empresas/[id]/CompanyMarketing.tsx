"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3, Users, Target, FileText, Globe, TrendingUp, TrendingDown, Minus,
  Search, MapPin, ArrowUpRight, Loader2, RefreshCw, ArrowDown, ArrowUp,
  ChevronUp, ChevronDown,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as ReTooltip,
  PieChart, Pie, Cell, LineChart, Line, Legend, CartesianGrid,
} from "recharts";
import { BUCKET_META, type TrafficBucket } from "@/lib/traffic-classifier";
import { flagFromCountryCode, ptCountryName } from "@/lib/country-flags";
import WorldGeoMap from "@/components/WorldGeoMap";

interface Kpi { value: number; delta?: number | null }
interface MarketingData {
  period: { days: number; start: string; end: string; prevStart: string; prevEnd: string };
  kpis: {
    sessions: Kpi; users: Kpi; conversions: Kpi;
    pageviews: Kpi; newUsers: Kpi;
    bounceRate: Kpi; avgSessionSec: Kpi; engagedSessions: Kpi;
  };
  dailySeries: { date: string; sessions: number; users: number; conversions: number; pageviews: number }[];
  trafficBuckets: {
    bucket: TrafficBucket;
    sessions: number; users: number; conversions: number;
    details: { rawSource: string; rawMedium: string; sessions: number; users: number; conversions: number }[];
  }[];
  topPages: { path: string; title: string | null; views: number; users: number }[];
  countries: {
    code: string; name: string; sessions: number; users: number;
    topCities: { city: string; sessions: number; users: number; region: string | null }[];
  }[];
  topQueries: {
    query: string; clicks: number; impressions: number; ctr: number;
    position: number;
    prevPosition: number | null;
    positionDelta: number | null;  // positivo = subiu (posição menor é melhor)
  }[];
  searchConsole: { totalClicks: number; totalImpressions: number; avgCtr: number };
  hasData: boolean;
}

const PERIODS = [
  { days: 7,  label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
];

// Cores hex pra recharts (não pode usar Tailwind direto)
const BUCKET_HEX: Record<TrafficBucket, string> = {
  AI:             "#10b981",
  ORGANIC_SEARCH: "#3b82f6",
  PAID_SEARCH:    "#f59e0b",
  INSTAGRAM:      "#ec4899",
  FACEBOOK:       "#1d4ed8",
  META_ADS:       "#8b5cf6",
  TIKTOK:         "#f43f5e",
  WHATSAPP:       "#22c55e",
  LINKEDIN:       "#0ea5e9",
  YOUTUBE:        "#ef4444",
  EMAIL:          "#fb923c",
  DIRECT:         "#94a3b8",
  REFERRAL:       "#06b6d4",
  OTHER:          "#64748b",
};

export default function CompanyMarketing({ companyId }: { companyId: string }) {
  const [data, setData] = useState<MarketingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [activeBucket, setActiveBucket] = useState<TrafficBucket | null>(null);
  const [querySort, setQuerySort] = useState<{ key: "clicks" | "impressions" | "ctr" | "position"; dir: "asc" | "desc" }>({
    key: "clicks",
    dir: "desc",
  });

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, days]);

  // Ordena as queries conforme a coluna selecionada. Position usa lógica
  // invertida — posição menor (1ª, 2ª) é melhor que maior (15ª, 30ª).
  const sortedQueries = useMemo(() => {
    if (!data) return [];
    const list = [...data.topQueries];
    list.sort((a, b) => {
      const va = a[querySort.key];
      const vb = b[querySort.key];
      const diff = va - vb;
      return querySort.dir === "asc" ? diff : -diff;
    });
    return list;
  }, [data, querySort]);

  function toggleSort(key: typeof querySort.key) {
    setQuerySort((prev) => prev.key === key
      // mesma coluna → inverte direção
      ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
      // coluna nova → começa na direção mais útil (position asc, resto desc)
      : { key, dir: key === "position" ? "asc" : "desc" }
    );
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/companies/${companyId}/marketing?days=${days}`);
      if (!r.ok) throw new Error((await r.json()).error || "Erro ao carregar");
      const j = await r.json();
      setData(j);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="p-10 text-center text-slate-500 text-sm">
        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
        Carregando dashboard…
      </div>
    );
  }
  if (error) return <div className="p-10 text-center text-red-400 text-sm">{error}</div>;
  if (!data) return null;

  return (
    <div className="p-5 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <BarChart3 className="w-5 h-5 text-blue-400" strokeWidth={2.25} />
          <div>
            <h2 className="text-white font-bold text-sm">Dashboard de Marketing</h2>
            <p className="text-slate-500 text-[11px]">
              Período: últimos {days} dias · vs {days}d anteriores
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Seletor de período */}
          <div className="flex bg-[#0a1220] border border-[#1e2d45] rounded-lg p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                  days === p.days
                    ? "bg-indigo-500/20 text-indigo-300"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
      </div>

      {!data.hasData && (
        <div className="p-8 text-center bg-amber-500/5 border border-amber-500/30 rounded-xl">
          <p className="text-amber-300 text-sm font-semibold mb-1">Sem dados ainda</p>
          <p className="text-slate-400 text-xs">
            Conecte uma integração Google e clique em <strong>Sync agora</strong> na aba Integrações
            pra começar a popular este dashboard.
          </p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={Users}         iconColor="text-cyan-400"    label="Sessões"        value={data.kpis.sessions.value} delta={data.kpis.sessions.delta} />
        <KpiCard icon={Users}         iconColor="text-indigo-400"  label="Usuários"       value={data.kpis.users.value}    delta={data.kpis.users.delta} />
        <KpiCard icon={Target}        iconColor="text-emerald-400" label="Conversões"     value={data.kpis.conversions.value} delta={data.kpis.conversions.delta} />
        <KpiCard icon={FileText}      iconColor="text-amber-400"   label="Visualizações"  value={data.kpis.pageviews.value} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SmallKpi label="Novos usuários"  value={data.kpis.newUsers.value} />
        <SmallKpi label="Tx. de rejeição" value={`${(data.kpis.bounceRate.value * 100).toFixed(1)}%`} />
        <SmallKpi label="Tempo médio"     value={fmtSeconds(data.kpis.avgSessionSec.value)} />
        <SmallKpi label="Sess. engajadas" value={data.kpis.engagedSessions.value} />
      </div>

      {/* Funil de conversão */}
      <MarketingFunnel
        impressions={data.searchConsole.totalImpressions}
        sessions={data.kpis.sessions.value}
        users={data.kpis.users.value}
        conversions={data.kpis.conversions.value}
      />

      {/* Série diária — multi-linha (visualizações + sessões + conversões) */}
      <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold text-sm">Tráfego diário</h3>
          {/* Mini-legenda manual pra controlar cores e estilo */}
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />Visualizações</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-500" />Sessões</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />Conversões</span>
          </div>
        </div>
        {data.dailySeries.length === 0 ? (
          <div className="text-slate-600 text-xs text-center py-12">Sem dados de série temporal.</div>
        ) : (
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.dailySeries} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#475569" }} stroke="#1e2d45" tickFormatter={(s) => s.slice(5)} />
                <YAxis tick={{ fontSize: 10, fill: "#475569" }} stroke="#1e2d45" />
                <ReTooltip
                  contentStyle={{ background: "#0d1525", border: "1px solid #1e2d45", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#cbd5e1" }}
                />
                <Line type="monotone" dataKey="pageviews"   name="Visualizações" stroke="#fbbf24" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="sessions"    name="Sessões"       stroke="#6366f1" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="conversions" name="Conversões"    stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Origens (pizza + detalhamento lado a lado) */}
      {data.trafficBuckets.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Pizza — ocupa 2/5 no desktop */}
          <div className="lg:col-span-2 bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
            <h3 className="text-white font-semibold text-sm mb-3">Origens do tráfego</h3>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.trafficBuckets}
                    dataKey="sessions"
                    nameKey="bucket"
                    cx="50%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={96}
                    paddingAngle={2}
                    onClick={(d: any) => setActiveBucket(d.bucket)}
                  >
                    {data.trafficBuckets.map((b) => (
                      <Cell
                        key={b.bucket}
                        fill={BUCKET_HEX[b.bucket] || "#64748b"}
                        stroke={activeBucket === b.bucket ? "#fff" : "#0a1220"}
                        strokeWidth={activeBucket === b.bucket ? 2 : 1}
                        opacity={activeBucket && activeBucket !== b.bucket ? 0.4 : 1}
                        style={{ cursor: "pointer" }}
                      />
                    ))}
                  </Pie>
                  <ReTooltip
                    contentStyle={{ background: "#0d1525", border: "1px solid #1e2d45", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: any, _n: any, d: any) => [`${v} sessões`, BUCKET_META[d.payload.bucket as TrafficBucket]?.label || d.payload.bucket]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {activeBucket && (
              <p className="text-[10px] text-slate-600 text-center mt-1">
                Clique numa fatia ou item ao lado pra filtrar — clique de novo pra limpar
              </p>
            )}
          </div>

          {/* Detalhamento — ocupa 3/5 no desktop */}
          <div className="lg:col-span-3 bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
            <h3 className="text-white font-semibold text-sm mb-3">Detalhamento de origens</h3>
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {data.trafficBuckets.map((b) => {
                const meta = BUCKET_META[b.bucket];
                const isActive = activeBucket === b.bucket;
                const pct = data.kpis.sessions.value > 0
                  ? (b.sessions / data.kpis.sessions.value) * 100
                  : 0;
                return (
                  <div key={b.bucket} className={isActive ? "bg-white/[0.04] -mx-2 px-2 rounded-lg" : ""}>
                    <button
                      onClick={() => setActiveBucket(isActive ? null : b.bucket)}
                      className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.03] transition-colors"
                    >
                      <span className="text-lg flex-shrink-0">{meta.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className={`text-sm font-semibold ${meta.color}`}>{meta.label}</span>
                          <span className="text-slate-300 text-xs font-mono">{b.sessions.toLocaleString("pt-BR")} sess</span>
                        </div>
                        <div className="h-1.5 bg-[#1e2d45] rounded-full overflow-hidden">
                          <div
                            className={meta.bgColor}
                            style={{ width: `${pct.toFixed(1)}%`, height: "100%" }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                          <span>{pct.toFixed(1)}% do tráfego</span>
                          <span>{b.users} usuários · {b.conversions} conv</span>
                        </div>
                      </div>
                    </button>
                    {isActive && b.details.length > 0 && (
                      <div className="ml-9 mt-1 mb-2 space-y-1">
                        {b.details.map((d) => (
                          <div key={`${d.rawSource}::${d.rawMedium}`} className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded bg-white/[0.02]">
                            <span className="text-slate-400 truncate font-mono text-[11px]">
                              {d.rawSource} <span className="text-slate-700">/</span> {d.rawMedium}
                            </span>
                            <span className="text-slate-500 text-[11px] flex-shrink-0">
                              {d.sessions} sess · {d.conversions} conv
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Mapa-mundi */}
      {data.countries.length > 0 && (
        <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-cyan-400" strokeWidth={2.25} />
              <h3 className="text-white font-semibold text-sm">De onde vêm os visitantes</h3>
            </div>
            <span className="text-[10px] text-slate-600">{data.countries.length} países</span>
          </div>
          <WorldGeoMap countries={data.countries} height={380} />
        </div>
      )}

      {/* Lista de países + Top páginas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lista de países */}
        <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-cyan-400" strokeWidth={2.25} />
              <h3 className="text-white font-semibold text-sm">Ranking por país</h3>
            </div>
            <span className="text-[10px] text-slate-600">{data.countries.length} países</span>
          </div>
          {data.countries.length === 0 ? (
            <div className="text-slate-600 text-xs text-center py-12">Sem dados geográficos.</div>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
              {data.countries.map((c) => {
                const pct = data.kpis.sessions.value > 0
                  ? (c.sessions / data.kpis.sessions.value) * 100
                  : 0;
                return (
                  <div key={c.code} className="px-2 py-1.5 rounded hover:bg-white/[0.02]">
                    <div className="flex items-center gap-2 text-xs mb-1">
                      <span className="text-base flex-shrink-0">{flagFromCountryCode(c.code)}</span>
                      <span className="text-slate-200 flex-1 truncate font-medium">
                        {ptCountryName(c.code, c.name)}
                      </span>
                      <span className="text-slate-400 font-mono text-[11px]">{c.sessions}</span>
                    </div>
                    <div className="h-1 bg-[#1e2d45] rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500" style={{ width: `${pct.toFixed(1)}%` }} />
                    </div>
                    {c.topCities.length > 0 && (
                      <div className="ml-7 mt-1 text-[10px] text-slate-600">
                        {c.topCities.slice(0, 3).map((ct) => `${ct.city} (${ct.sessions})`).join(" · ")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top páginas */}
        <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-amber-400" strokeWidth={2.25} />
              <h3 className="text-white font-semibold text-sm">Top páginas</h3>
            </div>
            <span className="text-[10px] text-slate-600">{data.topPages.length}</span>
          </div>
          {data.topPages.length === 0 ? (
            <div className="text-slate-600 text-xs text-center py-12">Sem dados de páginas.</div>
          ) : (
            <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
              {data.topPages.map((p) => (
                <div key={p.path} className="flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/[0.02]">
                  <div className="flex-1 min-w-0">
                    {p.title && <p className="text-slate-200 text-[11px] font-medium truncate">{p.title}</p>}
                    <p className="text-slate-500 text-[10px] font-mono truncate">{p.path}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-slate-200 font-mono text-[11px]">{p.views}</p>
                    <p className="text-slate-600 text-[10px]">{p.users} u</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Queries (Search Console) */}
      <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-blue-400" strokeWidth={2.25} />
            <h3 className="text-white font-semibold text-sm">Top buscas no Google</h3>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-slate-500">{data.searchConsole.totalClicks.toLocaleString("pt-BR")} cliques</span>
            <span className="text-slate-700">·</span>
            <span className="text-slate-500">{data.searchConsole.totalImpressions.toLocaleString("pt-BR")} impressões</span>
            <span className="text-slate-700">·</span>
            <span className="text-slate-500">CTR {(data.searchConsole.avgCtr * 100).toFixed(2)}%</span>
          </div>
        </div>
        {data.topQueries.length === 0 ? (
          <div className="text-slate-600 text-xs text-center py-8">
            Sem dados do Search Console. Conecte e clique em Sync agora.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1e2d45]">
                  <th className="text-left text-[10px] uppercase tracking-wider text-slate-600 font-bold pb-2 px-2">Query</th>
                  <SortHeader label="Cliques"     keyName="clicks"      sort={querySort} onClick={toggleSort} align="right" />
                  <SortHeader label="Impressões"  keyName="impressions" sort={querySort} onClick={toggleSort} align="right" />
                  <SortHeader label="CTR"         keyName="ctr"         sort={querySort} onClick={toggleSort} align="right" />
                  <SortHeader label="Posição"     keyName="position"    sort={querySort} onClick={toggleSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {sortedQueries.map((q) => {
                  const ctrPct = q.ctr * 100;
                  // CTR colorido: verde > 5%, amarelo 1-5%, vermelho < 1%
                  const ctrColor =
                    ctrPct >= 5 ? "text-emerald-400" :
                    ctrPct >= 1 ? "text-yellow-400"  :
                                   "text-red-400";
                  return (
                    <tr key={q.query} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
                      <td className="py-2 px-2 text-slate-200 text-xs truncate max-w-xs">{q.query}</td>
                      <td className="py-2 px-2 text-slate-300 text-xs font-mono text-right">{q.clicks}</td>
                      <td className="py-2 px-2 text-slate-500 text-xs font-mono text-right">{q.impressions}</td>
                      <td className={`py-2 px-2 text-xs font-mono font-semibold text-right ${ctrColor}`}>
                        {ctrPct.toFixed(2)}%
                      </td>
                      <td className="py-2 px-2 text-xs font-mono text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="text-slate-400">{q.position.toFixed(1)}</span>
                          <PositionDelta delta={q.positionDelta} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* Legenda de delta */}
            <p className="text-[10px] text-slate-600 mt-2 px-2">
              Comparação de posição vs período anterior:
              <span className="text-emerald-400 ml-2">↑ subiu</span>
              <span className="text-red-400 ml-2">↓ caiu</span>
              <span className="text-slate-500 ml-2">— sem dado anterior</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon, iconColor, label, value, delta,
}: {
  icon: any; iconColor: string; label: string; value: number; delta?: number | null;
}) {
  return (
    <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <Icon className={`w-4 h-4 ${iconColor}`} strokeWidth={2.25} />
        {delta !== undefined && delta !== null && <DeltaPill delta={delta} />}
      </div>
      <p className="text-white font-bold text-2xl">{value.toLocaleString("pt-BR")}</p>
      <p className="text-slate-500 text-[11px] mt-0.5">{label}</p>
    </div>
  );
}

function SmallKpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-[#0a1220]/50 border border-[#1e2d45]/50 rounded-lg px-3 py-2.5">
      <p className="text-slate-300 text-sm font-semibold">{typeof value === "number" ? value.toLocaleString("pt-BR") : value}</p>
      <p className="text-slate-600 text-[10px] mt-0.5">{label}</p>
    </div>
  );
}

function DeltaPill({ delta }: { delta: number }) {
  const isPositive = delta >= 5;
  const isNegative = delta <= -5;
  const Icon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;
  const color = isPositive ? "text-emerald-400 bg-emerald-500/15" : isNegative ? "text-red-400 bg-red-500/15" : "text-slate-400 bg-white/5";
  const sign = delta > 0 ? "+" : "";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${color}`}>
      <Icon className="w-2.5 h-2.5" />
      {sign}{delta.toFixed(0)}%
    </span>
  );
}

function fmtSeconds(s: number): string {
  if (!s || s < 1) return "0s";
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

// ─── Funil de marketing ──────────────────────────────────────────────────────
// Mostra a jornada Impressões → Sessões → Usuários → Conversões em 4 etapas
// com a taxa de conversão entre cada uma. Largura proporcional ao volume.

function MarketingFunnel({
  impressions, sessions, users, conversions,
}: {
  impressions: number; sessions: number; users: number; conversions: number;
}) {
  // Etapas em ordem de afunilamento. Filtra etapas zeradas pra não confundir
  // (ex: cliente sem Search Console conectado não tem impressões).
  const stages = [
    { key: "impressions", label: "Impressões",   value: impressions, color: "from-amber-500 to-orange-500",   accent: "text-amber-300",   bg: "bg-amber-500/10" },
    { key: "sessions",    label: "Sessões",      value: sessions,    color: "from-indigo-500 to-blue-500",    accent: "text-indigo-300",  bg: "bg-indigo-500/10" },
    { key: "users",       label: "Usuários",     value: users,       color: "from-cyan-500 to-teal-500",      accent: "text-cyan-300",    bg: "bg-cyan-500/10" },
    { key: "conversions", label: "Conversões",   value: conversions, color: "from-emerald-500 to-green-500",  accent: "text-emerald-300", bg: "bg-emerald-500/10" },
  ].filter((s) => s.value > 0);

  if (stages.length < 2) {
    // Sem dados suficientes pra montar funil — não polui a tela
    return null;
  }

  const max = stages[0].value;

  return (
    <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
      <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
        <Target className="w-4 h-4 text-emerald-400" strokeWidth={2.25} />
        Funil de conversão
      </h3>
      <div className="space-y-2">
        {stages.map((s, i) => {
          const widthPct = (s.value / max) * 100;
          const prev = i > 0 ? stages[i - 1] : null;
          const conversionRate = prev && prev.value > 0 ? (s.value / prev.value) * 100 : null;
          return (
            <div key={s.key}>
              {/* Indicador de conversão entre etapas */}
              {prev && conversionRate !== null && (
                <div className="flex items-center gap-2 mb-1 ml-2 text-[10px]">
                  <ArrowDown className="w-3 h-3 text-slate-600" strokeWidth={2} />
                  <span className={s.accent}>
                    {conversionRate.toFixed(1)}% conversão
                  </span>
                  <span className="text-slate-700">
                    ({prev.value.toLocaleString("pt-BR")} → {s.value.toLocaleString("pt-BR")})
                  </span>
                </div>
              )}
              {/* Barra do estágio */}
              <div className="relative">
                <div
                  className={`h-12 rounded-lg bg-gradient-to-r ${s.color} flex items-center px-3 transition-all`}
                  style={{ width: `${Math.max(widthPct, 12)}%` }}
                >
                  <span className="text-white text-xs font-bold uppercase tracking-wide drop-shadow">
                    {s.label}
                  </span>
                </div>
                {/* Valor à direita da barra */}
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-200 font-bold text-base font-mono">
                  {s.value.toLocaleString("pt-BR")}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Cabeçalho de coluna clicável (ordenação) ─────────────────────────────────

function SortHeader({
  label, keyName, sort, onClick, align,
}: {
  label: string;
  keyName: "clicks" | "impressions" | "ctr" | "position";
  sort: { key: string; dir: "asc" | "desc" };
  onClick: (k: any) => void;
  align?: "left" | "right";
}) {
  const isActive = sort.key === keyName;
  return (
    <th className={`text-${align ?? "left"} text-[10px] uppercase tracking-wider font-bold pb-2 px-2`}>
      <button
        onClick={() => onClick(keyName)}
        className={`flex items-center gap-1 hover:text-slate-200 transition-colors ${
          isActive ? "text-indigo-300" : "text-slate-600"
        } ${align === "right" ? "ml-auto" : ""}`}
      >
        {label}
        {isActive && (sort.dir === "asc"
          ? <ChevronUp className="w-3 h-3" strokeWidth={2.5} />
          : <ChevronDown className="w-3 h-3" strokeWidth={2.5} />)}
      </button>
    </th>
  );
}

// ─── Indicador visual de variação de posição ─────────────────────────────────

function PositionDelta({ delta }: { delta: number | null }) {
  // delta é positivo quando a posição MELHOROU (ex: caiu de 12 pra 7 = +5)
  if (delta === null) return <span className="text-slate-600 text-[10px]">—</span>;
  if (Math.abs(delta) < 0.5) return <span className="text-slate-500 text-[10px]">=</span>;
  const improved = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${
        improved ? "text-emerald-400" : "text-red-400"
      }`}
      title={improved ? `Subiu ${Math.abs(delta).toFixed(1)} posições` : `Caiu ${Math.abs(delta).toFixed(1)} posições`}
    >
      {improved
        ? <ArrowUp className="w-2.5 h-2.5" strokeWidth={3} />
        : <ArrowDown className="w-2.5 h-2.5" strokeWidth={3} />}
      {Math.abs(delta).toFixed(1)}
    </span>
  );
}
