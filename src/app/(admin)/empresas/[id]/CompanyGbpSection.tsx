"use client";

import { useEffect, useState } from "react";
import {
  MapPin, Eye, MousePointerClick, Star, MessageSquare, TrendingUp,
  TrendingDown, RefreshCw, AlertCircle, ExternalLink, Phone, Globe, Navigation,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

/**
 * Seção "Google Meu Negócio" do Dashboard de Marketing.
 *
 * Mostra 4 cards quando há integração BUSINESS_PROFILE conectada:
 *  1. 3 KPIs (impressões / ações / rating) com delta vs período anterior
 *  2. Gráfico Search vs Maps por dia
 *  3. Últimas 5 reviews + flag respondida/pendente
 *  4. Top 5 termos de busca
 *
 * + Banner "Profile Health" no topo quando completeness < 80
 * + Empty state quando não há integração
 */

interface GbpResponse {
  connected: boolean;
  message?: string;
  integration?: {
    id: string;
    status: string;
    lastSyncAt: string | null;
    lastSyncStatus: string | null;
    lastError: string | null;
    accountLabel: string | null;
  };
  period?: { days: number; start: string; end: string };
  kpis?: {
    impressions: { current: number; previous: number; deltaPct: number | null };
    actions: {
      current: number; previous: number; deltaPct: number | null;
      breakdown: { calls: number; website: number; directions: number };
    };
    rating: { average: number | null; total: number };
  };
  dailySeries?: { date: string; search: number; maps: number }[];
  reviews?: {
    id: string;
    googleReviewId: string;
    reviewerName: string | null;
    reviewerPhotoUrl: string | null;
    starRating: number;
    comment: string | null;
    createTime: string;
    hasReply: boolean;
    replyUpdateTime: string | null;
  }[];
  keywords?: {
    keyword: string;
    impressions: number;
    isThreshold: boolean;
    previousImpressions: number;
    deltaPct: number | null;
  }[];
  profileHealth?: {
    score: number;
    syncedAt: string;
    title: string | null;
    primaryCategory: string | null;
    missing: string[];
  } | null;
}

export default function CompanyGbpSection({ companyId, days = 30 }: { companyId: string; days?: number }) {
  const [data, setData] = useState<GbpResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/companies/${companyId}/marketing/gbp?days=${days}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      setData(json);
    } catch (e: any) {
      setError(e.message || "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, days]);

  async function handleSync() {
    if (!data?.integration?.id) return;
    setSyncing(true);
    try {
      const r = await fetch(`/api/companies/${companyId}/integrations/${data.integration.id}/sync`, { method: "POST" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      await load();
    } catch (e: any) {
      setError(`Falha no sync: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-[#1e2d45] rounded w-1/4" />
          <div className="grid grid-cols-3 gap-3">
            <div className="h-20 bg-[#1e2d45]/50 rounded" />
            <div className="h-20 bg-[#1e2d45]/50 rounded" />
            <div className="h-20 bg-[#1e2d45]/50 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/5 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
        Falha ao carregar dados do Google Meu Negócio: {error}
      </div>
    );
  }

  if (!data) return null;

  // Empty state — sem integração
  if (!data.connected) {
    return (
      <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
            <MapPin className="w-5 h-5 text-emerald-400" strokeWidth={2.25} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-semibold text-sm mb-1">Google Meu Negócio não conectado</h3>
            <p className="text-slate-500 text-xs mb-3">
              Conecte para acompanhar visualizações do perfil, ações dos clientes (ligações,
              rotas, cliques no site), reviews e top termos de busca.
            </p>
            <a
              href={`/empresas/${companyId}?tab=integracoes`}
              className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 font-semibold"
            >
              Configurar integração →
            </a>
          </div>
        </div>
      </div>
    );
  }

  const { kpis, dailySeries, reviews, keywords, profileHealth, integration } = data;
  const showProfileHealth = profileHealth && profileHealth.score < 80;

  return (
    <div className="space-y-4">
      {/* Header da seção */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <MapPin className="w-4 h-4 text-emerald-400" strokeWidth={2.25} />
          </div>
          <div>
            <h2 className="text-white font-bold text-sm">Google Meu Negócio</h2>
            <p className="text-slate-500 text-[11px]">
              {integration?.accountLabel ?? "perfil conectado"}
              {integration?.lastSyncAt && (
                <span className="ml-2 text-slate-600">
                  · sync {timeAgo(integration.lastSyncAt)}
                </span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-xs font-semibold disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Sincronizando…" : "Sincronizar agora"}
        </button>
      </div>

      {/* Aviso de erro / warning do último sync */}
      {(integration?.lastSyncStatus === "error" || integration?.lastSyncStatus === "warning") && integration.lastError && (
        <div className={`rounded-lg p-3 flex items-start gap-2 ${
          integration.lastSyncStatus === "error"
            ? "bg-red-500/5 border border-red-500/30"
            : "bg-amber-500/5 border border-amber-500/30"
        }`}>
          <AlertCircle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
            integration.lastSyncStatus === "error" ? "text-red-400" : "text-amber-400"
          }`} />
          <div className={`text-xs ${integration.lastSyncStatus === "error" ? "text-red-300" : "text-amber-300"}`}>
            {integration.lastSyncStatus === "error" ? "Último sync falhou:" : "Sync parcial — algumas etapas falharam:"}{" "}
            <span className="font-mono">{integration.lastError}</span>
          </div>
        </div>
      )}

      {/* Banner Profile Health (só se score < 80) */}
      {showProfileHealth && profileHealth && (
        <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400" strokeWidth={2.25} />
              <h3 className="text-amber-300 font-semibold text-sm">Perfil incompleto: {profileHealth.score}/100</h3>
            </div>
            <a
              href="https://business.google.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:text-amber-300 text-xs font-semibold inline-flex items-center gap-1"
            >
              Editar no Google <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="bg-[#0a1220] rounded-full h-1.5 mb-3 overflow-hidden">
            <div
              className="bg-amber-400 h-full rounded-full transition-all"
              style={{ width: `${profileHealth.score}%` }}
            />
          </div>
          {profileHealth.missing.length > 0 && (
            <ul className="space-y-1">
              {profileHealth.missing.map((m, i) => (
                <li key={i} className="text-amber-200/80 text-[11px] flex items-center gap-1.5">
                  <span className="text-amber-400">→</span> {m}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 3 KPIs */}
      {kpis && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <KpiCard
            icon={<Eye className="w-4 h-4" strokeWidth={2.25} />}
            label="Visualizações"
            value={kpis.impressions.current.toLocaleString("pt-BR")}
            deltaPct={kpis.impressions.deltaPct}
            color="emerald"
            subtitle={`${days} dias`}
          />
          <KpiCard
            icon={<MousePointerClick className="w-4 h-4" strokeWidth={2.25} />}
            label="Ações"
            value={kpis.actions.current.toLocaleString("pt-BR")}
            deltaPct={kpis.actions.deltaPct}
            color="blue"
            subtitle={
              <div className="flex items-center gap-2 text-[10px] text-slate-500">
                <span className="inline-flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" /> {kpis.actions.breakdown.calls}</span>
                <span className="inline-flex items-center gap-0.5"><Navigation className="w-2.5 h-2.5" /> {kpis.actions.breakdown.directions}</span>
                <span className="inline-flex items-center gap-0.5"><Globe className="w-2.5 h-2.5" /> {kpis.actions.breakdown.website}</span>
              </div>
            }
          />
          <KpiCard
            icon={<Star className="w-4 h-4" strokeWidth={2.25} />}
            label="Avaliação média"
            value={kpis.rating.average ? `${kpis.rating.average.toFixed(1)} ★` : "—"}
            deltaPct={null}
            color="amber"
            subtitle={`${kpis.rating.total} review${kpis.rating.total !== 1 ? "s" : ""}`}
          />
        </div>
      )}

      {/* Gráfico Search vs Maps */}
      <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" strokeWidth={2.25} />
            <h3 className="text-white font-semibold text-sm">Visualizações por canal</h3>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1 text-slate-500"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Busca</span>
            <span className="inline-flex items-center gap-1 text-slate-500"><span className="w-2 h-2 rounded-full bg-blue-400" /> Maps</span>
          </div>
        </div>
        {!dailySeries || dailySeries.length === 0 ? (
          <div className="text-slate-600 text-xs text-center py-12">Sem dados ainda. Aguarde a primeira sincronização.</div>
        ) : (
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailySeries.map((d) => ({ ...d, date: shortDate(d.date) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" />
                <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={{ stroke: "#1e2d45" }} />
                <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={{ stroke: "#1e2d45" }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0a1220", border: "1px solid #1e2d45", borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: "#cbd5e1" }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="search" stroke="#34d399" strokeWidth={2} name="Busca" dot={false} />
                <Line type="monotone" dataKey="maps" stroke="#60a5fa" strokeWidth={2} name="Maps" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Reviews + Keywords lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Últimas reviews */}
        <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-amber-400" strokeWidth={2.25} />
              <h3 className="text-white font-semibold text-sm">Últimas avaliações</h3>
            </div>
            <span className="text-[10px] text-slate-600">{reviews?.length ?? 0}</span>
          </div>
          {!reviews || reviews.length === 0 ? (
            <div className="text-slate-600 text-xs text-center py-12">Nenhuma avaliação ainda.</div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {reviews.map((r) => (
                <div key={r.id} className="border-b border-[#1e2d45]/50 pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Stars rating={r.starRating} />
                    <span className="text-slate-400 text-[11px]">{r.reviewerName || "Anônimo"}</span>
                    <span className="text-slate-600 text-[10px] ml-auto">{timeAgo(r.createTime)}</span>
                  </div>
                  {r.comment && (
                    <p className="text-slate-300 text-xs leading-relaxed mb-1.5 line-clamp-3">{r.comment}</p>
                  )}
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      r.hasReply
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-amber-500/10 text-amber-400"
                    }`}
                  >
                    {r.hasReply ? "✓ Respondida" : "⏳ Pendente"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top keywords */}
        <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-400" strokeWidth={2.25} />
              <h3 className="text-white font-semibold text-sm">Top buscas pelo perfil</h3>
            </div>
            <span className="text-[10px] text-slate-600">mês corrente</span>
          </div>
          {!keywords || keywords.length === 0 ? (
            <div className="text-slate-600 text-xs text-center py-12">Sem dados de busca ainda.</div>
          ) : (
            <div className="space-y-1.5">
              {keywords.map((k) => (
                <div key={k.keyword} className="flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/[0.02]">
                  <div className="flex-1 min-w-0 text-slate-200 text-xs truncate">
                    {k.keyword}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="text-slate-200 font-mono text-[11px]">
                      {k.isThreshold ? `<${k.impressions}` : k.impressions.toLocaleString("pt-BR")}
                    </span>
                    {k.deltaPct !== null && k.previousImpressions > 0 && (
                      <span className={`ml-2 text-[10px] font-semibold inline-flex items-center gap-0.5 ${k.deltaPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {k.deltaPct >= 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                        {Math.abs(k.deltaPct).toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-slate-600 mt-2 px-2">
                Termos com &lt; (asterisco) são aproximações do Google quando o volume é muito baixo.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon, label, value, deltaPct, color, subtitle,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  deltaPct: number | null;
  color: "emerald" | "blue" | "amber";
  subtitle?: React.ReactNode;
}) {
  const colorCls = {
    emerald: "text-emerald-400 bg-emerald-500/10",
    blue:    "text-blue-400 bg-blue-500/10",
    amber:   "text-amber-400 bg-amber-500/10",
  }[color];
  return (
    <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${colorCls}`}>{icon}</div>
        <span className="text-slate-400 text-[11px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <p className="text-white text-2xl font-bold mb-0.5">{value}</p>
      <div className="flex items-center justify-between gap-2">
        <div className="text-slate-500 text-[11px]">{subtitle}</div>
        {deltaPct !== null && (
          <span className={`text-[11px] font-semibold inline-flex items-center gap-0.5 ${deltaPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {deltaPct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(deltaPct).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`w-3 h-3 ${n <= rating ? "text-amber-400 fill-amber-400" : "text-slate-700"}`}
          strokeWidth={2}
        />
      ))}
    </div>
  );
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "agora";
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min}min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `há ${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `há ${day}d`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `há ${mo}mês`;
  return `há ${Math.floor(mo / 12)}a`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
