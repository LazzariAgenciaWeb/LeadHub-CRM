"use client";

import { useEffect, useState } from "react";
import {
  Megaphone, DollarSign, MousePointerClick, Eye, Target, TrendingUp,
  TrendingDown, RefreshCw, AlertCircle, Percent, Search, Award, ExternalLink,
} from "lucide-react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

/**
 * Seção de Ads (Google Ads / Meta Ads) do Dashboard de Marketing.
 *
 * Espelha o padrão do CompanyGbpSection: busca seu próprio endpoint
 * (/marketing/ads) e renderiza, quando há integração do provider conectada:
 *  1. KPIs (Custo, CPC, Custo/conv, Impressões, Cliques, Conversões) + ROAS, com delta
 *  2. Funil Impressões → Cliques → Conversões
 *  3. Gráfico diário: Custo × Cliques × Conversões
 *  4. Tabela por campanha
 * + Empty state quando não conectado.
 */

interface AdsKpi { current: number; previous?: number; deltaPct?: number | null }
interface AdsResponse {
  connected: boolean;
  provider: "GOOGLE_ADS" | "META_ADS";
  message?: string;
  integration?: {
    id: string;
    status: string;
    lastSyncAt: string | null;
    lastSyncStatus: string | null;
    lastError: string | null;
    accountId: string | null;
    accountLabel: string | null;
  };
  period?: { days: number; start: string; end: string };
  currency?: string | null;
  kpis?: {
    cost: AdsKpi; clicks: AdsKpi; impressions: AdsKpi; conversions: AdsKpi;
    conversionValue: AdsKpi; cpc: AdsKpi; cpa: AdsKpi;
    ctr: { current: number }; roas: { current: number };
  };
  dailySeries?: { date: string; cost: number; clicks: number; impressions: number; conversions: number }[];
  campaigns?: {
    id: string; name: string; status: string | null;
    impressions: number; clicks: number; ctr: number; cost: number;
    conversions: number; conversionValue: number; cpc: number; cpa: number; roas: number;
  }[];
  searchTerms?: {
    term: string; campaignName: string | null;
    impressions: number; clicks: number; ctr: number; cpc: number; cost: number; conversions: number;
  }[];
  topAds?: {
    id: string; campaignName: string | null; adGroupName: string | null; adType: string | null;
    headlines: string[]; descriptions: string[];
    finalUrl: string | null; path1: string | null; path2: string | null;
    impressions: number; clicks: number; ctr: number; cost: number; conversions: number; cpa: number;
  }[];
  hasData?: boolean;
}

const LABEL = { GOOGLE_ADS: "Google Ads", META_ADS: "Meta Ads" } as const;

export default function CompanyAdsSection({
  companyId, days = 30, provider = "GOOGLE_ADS",
}: {
  companyId: string;
  days?: number;
  provider?: "GOOGLE_ADS" | "META_ADS";
}) {
  const [data, setData] = useState<AdsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/companies/${companyId}/marketing/ads?days=${days}&provider=${provider}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e: any) {
      setError(e.message || "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, days, provider]);

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

  const fmtMoney = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: data?.currency || "BRL" }).format(v || 0);
  const fmtNum = (v: number) => (v || 0).toLocaleString("pt-BR");

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
        Falha ao carregar dados do {LABEL[provider]}: {error}
      </div>
    );
  }

  if (!data) return null;

  // Empty state — sem integração
  if (!data.connected) {
    return (
      <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
            <Megaphone className="w-5 h-5 text-amber-400" strokeWidth={2.25} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-semibold text-sm mb-1">{LABEL[provider]} não conectado</h3>
            <p className="text-slate-500 text-xs mb-3">
              Conecte para acompanhar investimento, cliques, conversões, CPC, CPA e ROAS por campanha.
            </p>
            <a
              href={`/empresas/${companyId}?tab=integracoes`}
              className="inline-flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 font-semibold"
            >
              Configurar integração →
            </a>
          </div>
        </div>
      </div>
    );
  }

  const { kpis, dailySeries, campaigns, searchTerms, topAds, integration } = data;

  return (
    <div className="space-y-4">
      {/* Header da seção */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Megaphone className="w-4 h-4 text-amber-400" strokeWidth={2.25} />
          </div>
          <div>
            <h2 className="text-white font-bold text-sm">{LABEL[provider]}</h2>
            <p className="text-slate-500 text-[11px]">
              {integration?.accountLabel ?? integration?.accountId ?? "conta conectada"}
              {integration?.lastSyncAt && (
                <span className="ml-2 text-slate-600">· sync {timeAgo(integration.lastSyncAt)}</span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-semibold disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Sincronizando…" : "Sincronizar agora"}
        </button>
      </div>

      {/* Aviso de erro do último sync */}
      {integration?.lastSyncStatus === "error" && integration.lastError && (
        <div className="rounded-lg p-3 flex items-start gap-2 bg-red-500/5 border border-red-500/30">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" />
          <div className="text-xs text-red-300">
            Último sync falhou: <span className="font-mono">{integration.lastError}</span>
          </div>
        </div>
      )}

      {/* Conectado mas sem dados ainda */}
      {!data.hasData && (
        <div className="rounded-lg p-3 flex items-start gap-2 bg-amber-500/5 border border-amber-500/30">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-400" />
          <div className="text-xs text-amber-300">
            Conectado, mas sem dados ainda. Selecione a conta na aba Integrações e clique em
            {" "}<strong>Sincronizar agora</strong> (ou aguarde a sincronização diária).
          </div>
        </div>
      )}

      {/* KPIs */}
      {kpis && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <KpiCard icon={<DollarSign className="w-4 h-4" strokeWidth={2.25} />} color="amber"
              label="Investimento" value={fmtMoney(kpis.cost.current)} deltaPct={kpis.cost.deltaPct} deltaGood="down" />
            <KpiCard icon={<MousePointerClick className="w-4 h-4" strokeWidth={2.25} />} color="amber"
              label="CPC médio" value={fmtMoney(kpis.cpc.current)} deltaPct={kpis.cpc.deltaPct} deltaGood="down" />
            <KpiCard icon={<Target className="w-4 h-4" strokeWidth={2.25} />} color="amber"
              label="Custo / conversão" value={fmtMoney(kpis.cpa.current)} deltaPct={kpis.cpa.deltaPct} deltaGood="down" />
            <KpiCard icon={<Eye className="w-4 h-4" strokeWidth={2.25} />} color="blue"
              label="Impressões" value={fmtNum(kpis.impressions.current)} deltaPct={kpis.impressions.deltaPct} deltaGood="up" />
            <KpiCard icon={<MousePointerClick className="w-4 h-4" strokeWidth={2.25} />} color="cyan"
              label="Cliques" value={fmtNum(kpis.clicks.current)} deltaPct={kpis.clicks.deltaPct} deltaGood="up"
              subtitle={`CTR ${(kpis.ctr.current * 100).toFixed(2)}%`} />
            <KpiCard icon={<Target className="w-4 h-4" strokeWidth={2.25} />} color="emerald"
              label="Conversões" value={fmtNum(Math.round(kpis.conversions.current * 100) / 100)} deltaPct={kpis.conversions.deltaPct} deltaGood="up"
              subtitle={kpis.roas.current > 0 ? `ROAS ${kpis.roas.current.toFixed(2)}x` : undefined} />
          </div>

          {/* Funil Impressões → Cliques → Conversões */}
          <AdsFunnel
            impressions={kpis.impressions.current}
            clicks={kpis.clicks.current}
            conversions={kpis.conversions.current}
            fmtNum={fmtNum}
          />
        </>
      )}

      {/* Gráfico diário: Custo (barras) × Cliques + Conversões (linhas) */}
      <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-amber-400" strokeWidth={2.25} />
            <h3 className="text-white font-semibold text-sm">Desempenho diário</h3>
          </div>
          <div className="flex items-center gap-3 text-[11px] flex-wrap">
            <span className="inline-flex items-center gap-1 text-slate-500"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400" /> Custo</span>
            <span className="inline-flex items-center gap-1 text-slate-500"><span className="w-2 h-2 rounded-full bg-cyan-400" /> Cliques</span>
            <span className="inline-flex items-center gap-1 text-slate-500"><span className="w-2 h-2 rounded-full bg-pink-400" /> Conversões</span>
          </div>
        </div>
        {!dailySeries || dailySeries.length === 0 ? (
          <div className="text-slate-600 text-xs text-center py-12">Sem dados ainda. Aguarde a primeira sincronização.</div>
        ) : (
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dailySeries.map((d) => ({ ...d, label: shortDate(d.date) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={{ stroke: "#1e2d45" }} />
                <YAxis yAxisId="money" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={{ stroke: "#1e2d45" }} />
                <YAxis yAxisId="count" orientation="right" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={{ stroke: "#1e2d45" }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0a1220", border: "1px solid #1e2d45", borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: "#cbd5e1" }}
                  formatter={(v: any, name: any) => (name === "Custo" ? fmtMoney(Number(v)) : fmtNum(Number(v)))}
                />
                <Bar  yAxisId="money" dataKey="cost"        name="Custo"      fill="#f59e0b" opacity={0.55} radius={[2, 2, 0, 0]} />
                <Line yAxisId="count" type="monotone" dataKey="clicks"      name="Cliques"    stroke="#22d3ee" strokeWidth={2} dot={false} />
                <Line yAxisId="count" type="monotone" dataKey="conversions" name="Conversões" stroke="#f472b6" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Tabela por campanha */}
      <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Percent className="w-4 h-4 text-amber-400" strokeWidth={2.25} />
            <h3 className="text-white font-semibold text-sm">Por campanha</h3>
          </div>
          <span className="text-[10px] text-slate-600">{campaigns?.length ?? 0}</span>
        </div>
        {!campaigns || campaigns.length === 0 ? (
          <div className="text-slate-600 text-xs text-center py-8">Sem campanhas no período.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1e2d45]">
                  <th className="text-left  text-[10px] uppercase tracking-wider text-slate-600 font-bold pb-2 px-2">Campanha</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-slate-600 font-bold pb-2 px-2">Impr.</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-slate-600 font-bold pb-2 px-2">Cliques</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-slate-600 font-bold pb-2 px-2">CTR</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-slate-600 font-bold pb-2 px-2">Custo</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-slate-600 font-bold pb-2 px-2">Conv.</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-slate-600 font-bold pb-2 px-2">CPA</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-slate-600 font-bold pb-2 px-2">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const ctrPct = c.ctr * 100;
                  const ctrColor = ctrPct >= 5 ? "text-emerald-400" : ctrPct >= 1 ? "text-yellow-400" : "text-red-400";
                  return (
                    <tr key={c.id} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
                      <td className="py-2 px-2 text-slate-200 text-xs truncate max-w-[220px]" title={c.name}>
                        {c.name}
                        {c.status && c.status !== "ENABLED" && (
                          <span className="ml-1.5 text-[9px] uppercase text-slate-500">({c.status.toLowerCase()})</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-slate-400 text-xs font-mono text-right">{fmtNum(c.impressions)}</td>
                      <td className="py-2 px-2 text-slate-300 text-xs font-mono text-right">{fmtNum(c.clicks)}</td>
                      <td className={`py-2 px-2 text-xs font-mono font-semibold text-right ${ctrColor}`}>{ctrPct.toFixed(2)}%</td>
                      <td className="py-2 px-2 text-slate-200 text-xs font-mono text-right">{fmtMoney(c.cost)}</td>
                      <td className="py-2 px-2 text-slate-300 text-xs font-mono text-right">{(Math.round(c.conversions * 100) / 100).toLocaleString("pt-BR")}</td>
                      <td className="py-2 px-2 text-slate-400 text-xs font-mono text-right">{c.conversions > 0 ? fmtMoney(c.cpa) : "—"}</td>
                      <td className="py-2 px-2 text-xs font-mono text-right text-violet-300">{c.roas > 0 ? `${c.roas.toFixed(2)}x` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Anúncio destaque — prévia do que mais converte */}
      {topAds && topAds.length > 0 && (
        <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Award className="w-4 h-4 text-amber-400" strokeWidth={2.25} />
            <h3 className="text-white font-semibold text-sm">Anúncio destaque</h3>
            <span className="text-[10px] text-slate-600">o que mais converte no período</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <AdPreview ad={topAds[0]} />
            <div className="grid grid-cols-2 gap-2.5">
              <MiniStat label="Conversões" value={(Math.round(topAds[0].conversions * 100) / 100).toLocaleString("pt-BR")} accent="emerald" />
              <MiniStat label="Custo / conv." value={topAds[0].conversions > 0 ? fmtMoney(topAds[0].cpa) : "—"} accent="amber" />
              <MiniStat label="Cliques" value={fmtNum(topAds[0].clicks)} accent="cyan" />
              <MiniStat label="CTR" value={`${(topAds[0].ctr * 100).toFixed(2)}%`} accent="blue" />
              <MiniStat label="Impressões" value={fmtNum(topAds[0].impressions)} accent="blue" />
              <MiniStat label="Investimento" value={fmtMoney(topAds[0].cost)} accent="amber" />
            </div>
          </div>
          {topAds[0].campaignName && (
            <p className="text-[10px] text-slate-600 mt-3">
              Campanha: {topAds[0].campaignName}
              {topAds[0].adGroupName && ` · ${provider === "META_ADS" ? "Conjunto" : "Grupo"}: ${topAds[0].adGroupName}`}
            </p>
          )}
        </div>
      )}

      {/* Termos de pesquisa — o que as pessoas digitaram.
          Só existe no Google Ads: a Meta não expõe consulta de pesquisa. */}
      {provider === "GOOGLE_ADS" && (
      <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-amber-400" strokeWidth={2.25} />
            <h3 className="text-white font-semibold text-sm">Termos de pesquisa</h3>
          </div>
          <span className="text-[10px] text-slate-600">
            {searchTerms?.length ? `top ${searchTerms.length}` : "0"}
          </span>
        </div>
        {!searchTerms || searchTerms.length === 0 ? (
          <div className="text-slate-600 text-xs text-center py-8">
            Sem termos de pesquisa no período. (Disponível só pra campanhas de Pesquisa.)
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-[#0a1220]">
                <tr className="border-b border-[#1e2d45]">
                  <th className="text-left  text-[10px] uppercase tracking-wider text-slate-600 font-bold pb-2 px-2">Termo pesquisado</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-slate-600 font-bold pb-2 px-2">Impr.</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-slate-600 font-bold pb-2 px-2">Cliques</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-slate-600 font-bold pb-2 px-2">CTR</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-slate-600 font-bold pb-2 px-2">CPC</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-slate-600 font-bold pb-2 px-2">Conv.</th>
                </tr>
              </thead>
              <tbody>
                {searchTerms.map((t, i) => {
                  const ctrPct = t.ctr * 100;
                  const ctrColor = ctrPct >= 5 ? "text-emerald-400" : ctrPct >= 1 ? "text-yellow-400" : "text-red-400";
                  return (
                    <tr key={`${t.term}-${i}`} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
                      <td className="py-2 px-2 text-slate-200 text-xs truncate max-w-[280px]" title={t.term}>{t.term}</td>
                      <td className="py-2 px-2 text-slate-400 text-xs font-mono text-right">{fmtNum(t.impressions)}</td>
                      <td className="py-2 px-2 text-slate-300 text-xs font-mono text-right">{fmtNum(t.clicks)}</td>
                      <td className={`py-2 px-2 text-xs font-mono font-semibold text-right ${ctrColor}`}>{ctrPct.toFixed(2)}%</td>
                      <td className="py-2 px-2 text-slate-400 text-xs font-mono text-right">{t.clicks > 0 ? fmtMoney(t.cpc) : "—"}</td>
                      <td className="py-2 px-2 text-slate-300 text-xs font-mono text-right">{(Math.round(t.conversions * 100) / 100).toLocaleString("pt-BR")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// ─── Prévia de anúncio (reconstruída no estilo do anúncio de busca) ─────────────

function AdPreview({ ad }: { ad: NonNullable<AdsResponse["topAds"]>[number] }) {
  const domain = (() => {
    if (!ad.finalUrl) return "";
    try { return new URL(ad.finalUrl).hostname.replace(/^www\./, ""); } catch { return ad.finalUrl; }
  })();
  const pathParts = [ad.path1, ad.path2].filter(Boolean).join("/");
  const displayUrl = domain ? `${domain}${pathParts ? "/" + pathParts : ""}` : "—";
  const headline = (ad.headlines || []).slice(0, 3).join(" | ") || "(sem título)";
  const description = (ad.descriptions || []).slice(0, 2).join(" ") || "";

  return (
    <div className="bg-white rounded-lg p-3.5 border border-slate-200">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] font-bold text-slate-900 border border-slate-400 rounded px-1 leading-tight">Anúncio</span>
        <span className="text-[12px] text-slate-700 truncate">{displayUrl}</span>
      </div>
      <p className="text-[#1a0dab] text-[17px] leading-snug font-normal hover:underline cursor-default line-clamp-2">
        {headline}
      </p>
      {description && (
        <p className="text-[#4d5156] text-[13px] leading-snug mt-1 line-clamp-3">{description}</p>
      )}
      {ad.finalUrl && (
        <a
          href={ad.finalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 mt-2"
        >
          Abrir página <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent: "emerald" | "amber" | "cyan" | "blue" }) {
  const cls = {
    emerald: "text-emerald-300",
    amber: "text-amber-300",
    cyan: "text-cyan-300",
    blue: "text-blue-300",
  }[accent];
  return (
    <div className="bg-[#0a1220]/60 border border-[#1e2d45]/60 rounded-lg px-3 py-2">
      <p className={`text-sm font-bold font-mono ${cls}`}>{value}</p>
      <p className="text-slate-600 text-[10px] mt-0.5">{label}</p>
    </div>
  );
}

// ─── Sub-componentes ───────────────────────────────────────────────────────────

function KpiCard({
  icon, label, value, deltaPct, color, subtitle, deltaGood = "up",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  deltaPct?: number | null;
  color: "amber" | "blue" | "cyan" | "emerald";
  subtitle?: string;
  deltaGood?: "up" | "down"; // direção que é "boa" (verde). custo/CPC/CPA: down é bom.
}) {
  const colorCls = {
    amber:   "text-amber-400 bg-amber-500/10",
    blue:    "text-blue-400 bg-blue-500/10",
    cyan:    "text-cyan-400 bg-cyan-500/10",
    emerald: "text-emerald-400 bg-emerald-500/10",
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
        {deltaPct !== null && deltaPct !== undefined && <DeltaPill deltaPct={deltaPct} good={deltaGood} />}
      </div>
    </div>
  );
}

function DeltaPill({ deltaPct, good }: { deltaPct: number; good: "up" | "down" }) {
  const up = deltaPct >= 0;
  // "bom" = verde. Pra custo/CPC/CPA, cair (down) é bom.
  const isGood = good === "up" ? up : !up;
  const color = Math.abs(deltaPct) < 0.05 ? "text-slate-400" : isGood ? "text-emerald-400" : "text-red-400";
  return (
    <span className={`text-[11px] font-semibold inline-flex items-center gap-0.5 ${color}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {Math.abs(deltaPct).toFixed(1)}%
    </span>
  );
}

function AdsFunnel({
  impressions, clicks, conversions, fmtNum,
}: {
  impressions: number; clicks: number; conversions: number; fmtNum: (v: number) => string;
}) {
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const cvr = clicks > 0 ? (conversions / clicks) * 100 : 0;
  const stages = [
    { label: "Impressões", value: impressions, pct: 100, color: "bg-blue-500", text: "text-blue-300" },
    { label: "Cliques",    value: clicks,      pct: ctr, color: "bg-cyan-500", text: "text-cyan-300", note: `${ctr.toFixed(2)}% CTR` },
    { label: "Conversões", value: Math.round(conversions * 100) / 100, pct: cvr, color: "bg-pink-500", text: "text-pink-300", note: `${cvr.toFixed(2)}% conv.` },
  ];
  return (
    <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
      <h3 className="text-white font-semibold text-sm mb-3">Funil do anúncio</h3>
      <div className="space-y-2.5">
        {stages.map((s) => (
          <div key={s.label}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className={`font-semibold ${s.text}`}>{s.label}</span>
              <span className="text-slate-300 font-mono">
                {fmtNum(s.value)}
                {s.note && <span className="text-slate-600 ml-2">{s.note}</span>}
              </span>
            </div>
            <div className="h-2 bg-[#1e2d45] rounded-full overflow-hidden">
              <div className={`${s.color} h-full rounded-full`} style={{ width: `${Math.max(2, Math.min(100, s.pct)).toFixed(1)}%` }} />
            </div>
          </div>
        ))}
      </div>
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
  return `há ${day}d`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
