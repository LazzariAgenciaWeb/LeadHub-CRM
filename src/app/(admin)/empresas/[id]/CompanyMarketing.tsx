"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3, Users, Target, FileText, Globe, TrendingUp, TrendingDown, Minus,
  Search, MapPin, ArrowUpRight, Loader2, RefreshCw,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as ReTooltip,
  PieChart, Pie, Cell,
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
  dailySeries: { date: string; sessions: number; users: number; conversions: number }[];
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
  topQueries: { query: string; clicks: number; impressions: number; ctr: number; position: number }[];
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

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, days]);

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

      {/* Série diária + Origens (donut) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
          <h3 className="text-white font-semibold text-sm mb-3">Sessões / dia</h3>
          {data.dailySeries.length === 0 ? (
            <div className="text-slate-600 text-xs text-center py-12">Sem dados de série temporal.</div>
          ) : (
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.dailySeries}>
                  <defs>
                    <linearGradient id="sessionsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#475569" }} stroke="#1e2d45" tickFormatter={(s) => s.slice(5)} />
                  <YAxis tick={{ fontSize: 10, fill: "#475569" }} stroke="#1e2d45" />
                  <ReTooltip
                    contentStyle={{ background: "#0d1525", border: "1px solid #1e2d45", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "#cbd5e1" }}
                  />
                  <Area type="monotone" dataKey="sessions" stroke="#6366f1" fill="url(#sessionsGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
          <h3 className="text-white font-semibold text-sm mb-3">Origens do tráfego</h3>
          {data.trafficBuckets.length === 0 ? (
            <div className="text-slate-600 text-xs text-center py-12">Sem dados.</div>
          ) : (
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.trafficBuckets}
                    dataKey="sessions"
                    nameKey="bucket"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={80}
                    paddingAngle={2}
                    onClick={(d: any) => setActiveBucket(d.bucket)}
                  >
                    {data.trafficBuckets.map((b) => (
                      <Cell key={b.bucket} fill={BUCKET_HEX[b.bucket] || "#64748b"} stroke="#0a1220" />
                    ))}
                  </Pie>
                  <ReTooltip
                    contentStyle={{ background: "#0d1525", border: "1px solid #1e2d45", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: any, _n: any, d: any) => [`${v} sessões`, BUCKET_META[d.payload.bucket as TrafficBucket]?.label || d.payload.bucket]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Lista detalhada de origens */}
      {data.trafficBuckets.length > 0 && (
        <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
          <h3 className="text-white font-semibold text-sm mb-3">Detalhamento de origens</h3>
          <div className="space-y-2">
            {data.trafficBuckets.map((b) => {
              const meta = BUCKET_META[b.bucket];
              const isActive = activeBucket === b.bucket;
              const pct = data.kpis.sessions.value > 0
                ? (b.sessions / data.kpis.sessions.value) * 100
                : 0;
              return (
                <div key={b.bucket}>
                  <button
                    onClick={() => setActiveBucket(isActive ? null : b.bucket)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/[0.03] transition-colors"
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
                  {["Query", "Cliques", "Impressões", "CTR", "Posição"].map((h) => (
                    <th key={h} className="text-left text-[10px] uppercase tracking-wider text-slate-600 font-bold pb-2 px-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.topQueries.map((q) => (
                  <tr key={q.query} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
                    <td className="py-2 px-2 text-slate-200 text-xs truncate max-w-xs">{q.query}</td>
                    <td className="py-2 px-2 text-slate-300 text-xs font-mono">{q.clicks}</td>
                    <td className="py-2 px-2 text-slate-500 text-xs font-mono">{q.impressions}</td>
                    <td className="py-2 px-2 text-slate-400 text-xs font-mono">{(q.ctr * 100).toFixed(2)}%</td>
                    <td className="py-2 px-2 text-slate-400 text-xs font-mono">{q.position.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
