"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Eye, Users, Target, DollarSign, ArrowRight, Info, Megaphone, Sprout,
} from "lucide-react";
import { isPaidBucket, type TrafficBucket } from "@/lib/traffic-classifier";

/**
 * Painel de entrada do Dashboard de Marketing.
 *
 * Responde "como estamos?" em cinco segundos: visualizações, pessoas e
 * conversões — cada uma quebrada em orgânico × patrocinado — mais o
 * investimento em mídia.
 *
 * Decisão importante sobre a quebra orgânico/pago: usamos a classificação do
 * PRÓPRIO GA4 (baldes PAID_SEARCH/META_ADS, que vêm de gclid/fbclid), não os
 * números que Google Ads e Meta Ads reportam. Motivo: somar as duas fontes
 * contaria a mesma conversão duas vezes (o clique no anúncio que vira lead
 * aparece nos dois lugares). Os números das plataformas aparecem separados, no
 * card de investimento e na aba Patrocinado.
 */

interface Kpi { value: number; delta?: number | null }

export interface OverviewOrganic {
  kpis: { sessions: Kpi; users: Kpi; conversions: Kpi; pageviews: Kpi };
  trafficBuckets: {
    bucket: TrafficBucket;
    sessions: number; users: number; conversions: number;
  }[];
}

interface AdsSummary {
  currency: string | null;
  anyConnected: boolean;
  providers: {
    provider: "GOOGLE_ADS" | "META_ADS";
    connected: boolean;
    accountLabel: string | null;
    cost: number; clicks: number; impressions: number; conversions: number; conversionValue: number;
    prevCost: number; prevConversions: number;
  }[];
  totals: {
    cost: number; clicks: number; impressions: number; conversions: number;
    conversionValue: number; prevCost: number; prevConversions: number;
  };
}

const PROVIDER_LABEL = { GOOGLE_ADS: "Google Ads", META_ADS: "Meta Ads" } as const;

export default function MarketingOverview({
  companyId, days, organic, onGoToTab, hideCost = false,
}: {
  companyId: string;
  days: number;
  organic: OverviewOrganic;
  onGoToTab: (tab: "organico" | "pago") => void;
  /** Portal do cliente: sem o card de investimento em mídia. */
  hideCost?: boolean;
}) {
  const [ads, setAds] = useState<AdsSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/companies/${companyId}/marketing/ads-summary?days=${days}`);
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setAds(j);
      } catch {
        // painel funciona sem mídia paga — só não mostra a quebra
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, days]);

  // Quebra orgânico × pago a partir dos baldes do GA4.
  const split = useMemo(() => {
    const acc = {
      paidUsers: 0, paidSessions: 0, paidConversions: 0,
      orgUsers: 0, orgSessions: 0, orgConversions: 0,
    };
    for (const b of organic.trafficBuckets ?? []) {
      const paid = isPaidBucket(b.bucket);
      acc[paid ? "paidUsers" : "orgUsers"] += b.users;
      acc[paid ? "paidSessions" : "orgSessions"] += b.sessions;
      acc[paid ? "paidConversions" : "orgConversions"] += b.conversions;
    }
    return acc;
  }, [organic.trafficBuckets]);

  const fmt = (v: number) => Math.round(v).toLocaleString("pt-BR");
  const money = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: ads?.currency || "BRL" }).format(v || 0);

  const totalSessions = split.orgSessions + split.paidSessions;
  const paidShare = totalSessions > 0 ? split.paidSessions / totalSessions : 0;

  const adsTotals = ads?.totals;
  const cpa = adsTotals && adsTotals.conversions > 0 ? adsTotals.cost / adsTotals.conversions : null;
  const costDelta =
    adsTotals && adsTotals.prevCost > 0
      ? ((adsTotals.cost - adsTotals.prevCost) / adsTotals.prevCost) * 100
      : null;

  return (
    <div className="space-y-4">
      {/* Cards principais */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <BigCard
          icon={<Eye className="w-4 h-4" strokeWidth={2.25} />}
          accent="amber"
          label="Visualizações"
          value={fmt(organic.kpis.pageviews.value)}
          hint="páginas vistas no site"
          extra={
            ads?.anyConnected
              ? { label: "impressões de anúncio", value: fmt(adsTotals?.impressions ?? 0) }
              : undefined
          }
        />
        <BigCard
          icon={<Users className="w-4 h-4" strokeWidth={2.25} />}
          accent="indigo"
          label="Pessoas"
          value={fmt(organic.kpis.users.value)}
          delta={organic.kpis.users.delta}
          hint="usuários únicos no site"
          breakdown={{ organic: split.orgUsers, paid: split.paidUsers }}
        />
        <BigCard
          icon={<Target className="w-4 h-4" strokeWidth={2.25} />}
          accent="emerald"
          label="Conversões"
          value={fmt(organic.kpis.conversions.value)}
          delta={organic.kpis.conversions.delta}
          hint="eventos marcados como conversão"
          breakdown={{ organic: split.orgConversions, paid: split.paidConversions }}
        />
      </div>

      {/* Investimento — só quando há mídia conectada */}
      {ads?.anyConnected && !hideCost && (
        <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-amber-400" strokeWidth={2.25} />
              <h3 className="text-white font-semibold text-sm">Investimento em mídia</h3>
            </div>
            <button
              onClick={() => onGoToTab("pago")}
              className="inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 font-semibold"
            >
              Ver relatório completo <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MiniStat label="Investido" value={money(adsTotals?.cost ?? 0)} delta={costDelta} accent="amber" />
            <MiniStat label="Cliques" value={fmt(adsTotals?.clicks ?? 0)} accent="cyan" />
            <MiniStat
              label="Conversões (plataforma)"
              value={fmt(adsTotals?.conversions ?? 0)}
              accent="violet"
            />
            <MiniStat label="Custo / conversão" value={cpa != null ? money(cpa) : "—"} accent="emerald" />
          </div>

          {/* Quebra por plataforma */}
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ads.providers.filter((p) => p.connected).map((p) => (
              <div key={p.provider} className="bg-black/20 border border-white/5 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-slate-300 text-xs font-semibold">{PROVIDER_LABEL[p.provider]}</p>
                  <p className="text-slate-600 text-[10px] truncate">{p.accountLabel ?? "conta conectada"}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-white text-xs font-mono font-semibold">{money(p.cost)}</p>
                  <p className="text-slate-500 text-[10px]">{fmt(p.conversions)} conv.</p>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-3 text-[10px] text-slate-600 flex items-start gap-1.5">
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>
              &quot;Conversões (plataforma)&quot; é o que Google e Meta reportam por conta própria e quase nunca bate
              com o GA4 — cada um usa uma janela de atribuição diferente. Os cards de cima usam só o GA4, por isso
              os dois números não somam.
            </span>
          </p>
        </div>
      )}

      {/* De onde veio o tráfego — barra orgânico × pago */}
      {totalSessions > 0 && (
        <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-white font-semibold text-sm">De onde veio o tráfego</h3>
            <span className="text-[10px] text-slate-600">{fmt(totalSessions)} sessões</span>
          </div>

          <div className="flex h-3 rounded-full overflow-hidden bg-[#1e2d45]">
            <div
              className="bg-emerald-500"
              style={{ width: `${(1 - paidShare) * 100}%` }}
              title={`Orgânico: ${fmt(split.orgSessions)} sessões`}
            />
            <div
              className="bg-amber-500"
              style={{ width: `${paidShare * 100}%` }}
              title={`Patrocinado: ${fmt(split.paidSessions)} sessões`}
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <button
              onClick={() => onGoToTab("organico")}
              className="text-left bg-black/20 hover:bg-black/40 border border-white/5 rounded-lg p-3 transition-colors group"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Sprout className="w-3.5 h-3.5 text-emerald-400" strokeWidth={2.25} />
                <span className="text-emerald-300 text-[11px] font-bold uppercase tracking-wide">Orgânico</span>
              </div>
              <p className="text-white text-lg font-bold leading-none">{fmt(split.orgSessions)}</p>
              <p className="text-slate-500 text-[10px] mt-1">
                {((1 - paidShare) * 100).toFixed(0)}% do tráfego · {fmt(split.orgConversions)} conversões
              </p>
              <span className="text-slate-600 group-hover:text-emerald-400 text-[10px] font-semibold inline-flex items-center gap-1 mt-1.5">
                Ver detalhes <ArrowRight className="w-2.5 h-2.5" />
              </span>
            </button>

            <button
              onClick={() => onGoToTab("pago")}
              className="text-left bg-black/20 hover:bg-black/40 border border-white/5 rounded-lg p-3 transition-colors group"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Megaphone className="w-3.5 h-3.5 text-amber-400" strokeWidth={2.25} />
                <span className="text-amber-300 text-[11px] font-bold uppercase tracking-wide">Patrocinado</span>
              </div>
              <p className="text-white text-lg font-bold leading-none">{fmt(split.paidSessions)}</p>
              <p className="text-slate-500 text-[10px] mt-1">
                {(paidShare * 100).toFixed(0)}% do tráfego · {fmt(split.paidConversions)} conversões
              </p>
              <span className="text-slate-600 group-hover:text-amber-400 text-[10px] font-semibold inline-flex items-center gap-1 mt-1.5">
                Ver detalhes <ArrowRight className="w-2.5 h-2.5" />
              </span>
            </button>
          </div>

          {split.paidSessions === 0 && (
            <p className="mt-3 text-[10px] text-slate-600">
              Nenhuma sessão com identificador de anúncio (gclid/fbclid) no período. Se há campanha rodando,
              confira se os links dos anúncios preservam os parâmetros de rastreio.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Peças ───────────────────────────────────────────────────────────────────

const ACCENT: Record<string, { text: string; bg: string; bar: string }> = {
  amber:   { text: "text-amber-400",   bg: "bg-amber-500/10",   bar: "bg-amber-500" },
  indigo:  { text: "text-indigo-400",  bg: "bg-indigo-500/10",  bar: "bg-indigo-500" },
  emerald: { text: "text-emerald-400", bg: "bg-emerald-500/10", bar: "bg-emerald-500" },
  cyan:    { text: "text-cyan-400",    bg: "bg-cyan-500/10",    bar: "bg-cyan-500" },
  violet:  { text: "text-violet-400",  bg: "bg-violet-500/10",  bar: "bg-violet-500" },
};

function BigCard({
  icon, accent, label, value, hint, delta, breakdown, extra,
}: {
  icon: React.ReactNode;
  accent: keyof typeof ACCENT | string;
  label: string;
  value: string;
  hint?: string;
  delta?: number | null;
  breakdown?: { organic: number; paid: number };
  extra?: { label: string; value: string };
}) {
  const a = ACCENT[accent] ?? ACCENT.indigo;
  const total = breakdown ? breakdown.organic + breakdown.paid : 0;
  const paidPct = total > 0 ? (breakdown!.paid / total) * 100 : 0;
  const fmt = (v: number) => Math.round(v).toLocaleString("pt-BR");

  return (
    <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-lg ${a.bg} flex items-center justify-center ${a.text}`}>{icon}</div>
          <span className="text-slate-400 text-xs font-semibold">{label}</span>
        </div>
        {delta != null && <DeltaPill delta={delta} />}
      </div>

      <p className="text-white text-2xl font-bold leading-none">{value}</p>
      {hint && <p className="text-slate-600 text-[10px] mt-1">{hint}</p>}

      {breakdown && total > 0 && (
        <div className="mt-3">
          <div className="flex h-1.5 rounded-full overflow-hidden bg-[#1e2d45]">
            <div className="bg-emerald-500" style={{ width: `${100 - paidPct}%` }} />
            <div className="bg-amber-500" style={{ width: `${paidPct}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1.5 text-[10px]">
            <span className="text-emerald-300">
              <span className="font-mono font-semibold">{fmt(breakdown.organic)}</span> orgânico
            </span>
            <span className="text-amber-300">
              <span className="font-mono font-semibold">{fmt(breakdown.paid)}</span> pago
            </span>
          </div>
        </div>
      )}

      {extra && (
        <div className="mt-3 pt-2.5 border-t border-[#1e2d45] flex items-baseline justify-between">
          <span className="text-slate-600 text-[10px]">{extra.label}</span>
          <span className="text-slate-300 text-xs font-mono font-semibold">{extra.value}</span>
        </div>
      )}
    </div>
  );
}

function MiniStat({
  label, value, delta, accent,
}: {
  label: string; value: string; delta?: number | null; accent: keyof typeof ACCENT | string;
}) {
  const a = ACCENT[accent] ?? ACCENT.indigo;
  return (
    <div className="bg-black/20 border border-white/5 rounded-lg p-2.5">
      <div className="flex items-center justify-between gap-1">
        <p className="text-slate-500 text-[10px] uppercase tracking-wide font-bold truncate">{label}</p>
        {delta != null && <DeltaPill delta={delta} />}
      </div>
      <p className={`text-sm font-bold font-mono mt-1 ${a.text}`}>{value}</p>
    </div>
  );
}

function DeltaPill({ delta }: { delta: number }) {
  const up = delta >= 0;
  return (
    <span
      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
        up ? "text-emerald-300 bg-emerald-500/15" : "text-red-300 bg-red-500/15"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}%
    </span>
  );
}
