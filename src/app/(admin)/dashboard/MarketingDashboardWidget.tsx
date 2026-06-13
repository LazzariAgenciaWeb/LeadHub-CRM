"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, Users, Target, Award, XCircle, ArrowUpRight, Loader2 } from "lucide-react";

type FunnelStage = { key: string; label: string; value: number };
type MarketingData = {
  kpis: { sessions: { value: number }; users: { value: number } };
  conversionsLeadHub: number;
  conversionEvents: { eventName: string; label: string; count: number; isConversion: boolean }[];
  funnel: {
    profile: "basico" | "captacao" | "completo";
    stages: FunnelStage[];
    won: number | null;
    lost: number | null;
  };
  hasData: boolean;
};

/**
 * Card de Marketing no Dashboard principal. Aparece só pra empresas com módulo Marketing
 * contratado. Mostra cards principais + funil adaptativo (3 / 4 / 6 estágios) coerente
 * com os módulos contratados (Prospecção, Oportunidades).
 */
export default function MarketingDashboardWidget({ companyId }: { companyId: string }) {
  const [data, setData] = useState<MarketingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`/api/companies/${companyId}/marketing?days=30`);
        if (!r.ok) return;
        setData(await r.json());
      } finally {
        setLoading(false);
      }
    })();
  }, [companyId]);

  if (loading) {
    return (
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5 flex items-center justify-center text-slate-500 text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Carregando marketing…
      </div>
    );
  }

  if (!data || !data.hasData) {
    return (
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-white font-bold text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-blue-400" /> Marketing
            </h2>
            <p className="text-slate-500 text-xs mt-1">Conecte GA4 ou Search Console pra ver os dados aqui.</p>
          </div>
          <Link href="/relatorios?secao=marketing" className="text-indigo-400 text-xs font-medium hover:underline flex items-center gap-1">
            Abrir <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    );
  }

  const { funnel } = data;
  const max = Math.max(...funnel.stages.map((s) => s.value), 1);
  const hasWonLost = funnel.won !== null || funnel.lost !== null;

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-bold text-sm flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-400" /> Marketing — últimos 30 dias
        </h2>
        <Link href="/relatorios?secao=marketing" className="text-indigo-400 text-xs font-medium hover:underline flex items-center gap-1">
          Ver detalhes <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>

      {/* Cards principais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniCard icon={Users} iconColor="text-cyan-400" label="Sessões" value={data.kpis.sessions.value} />
        <MiniCard icon={Users} iconColor="text-indigo-400" label="Usuários" value={data.kpis.users.value} />
        <MiniCard icon={Target} iconColor="text-emerald-400" label="Conversões" value={data.conversionsLeadHub} sub={data.conversionEvents.length > 0 ? `${data.conversionEvents.length} evento(s)` : "Nenhum marcado"} />
        {hasWonLost && (
          <MiniCard icon={Award} iconColor="text-emerald-300" label="Ganho" value={funnel.won ?? 0} />
        )}
      </div>

      {/* Funil compacto */}
      <div>
        <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wide mb-2">
          Funil adaptado ao seu plano
        </div>
        <div className="space-y-1.5">
          {funnel.stages.map((stage) => {
            const widthPct = Math.max(8, (stage.value / max) * 100);
            return (
              <div key={stage.key} className="flex items-center gap-3">
                <div className="w-28 shrink-0 text-slate-400 text-[11px] truncate">{stage.label}</div>
                <div className="flex-1">
                  <div
                    className="h-5 bg-gradient-to-r from-indigo-500/40 to-cyan-500/40 border border-indigo-400/30 rounded flex items-center px-2"
                    style={{ width: `${widthPct}%` }}
                  >
                    <span className="text-white text-[11px] font-semibold tabular-nums">
                      {stage.value.toLocaleString("pt-BR")}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          {hasWonLost && funnel.lost !== null && funnel.lost > 0 && (
            <div className="flex items-center gap-3 pt-1">
              <div className="w-28 shrink-0 flex items-center gap-1 text-red-300 text-[11px]">
                <XCircle className="w-3 h-3" /> Perdido
              </div>
              <div className="text-white text-[11px] font-semibold tabular-nums">
                {funnel.lost.toLocaleString("pt-BR")}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniCard({
  icon: Icon, iconColor, label, value, sub,
}: {
  icon: typeof Users; iconColor: string; label: string; value: number; sub?: string;
}) {
  return (
    <div className="bg-[#0a1220] border border-[#1e2d45] rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3.5 h-3.5 ${iconColor}`} strokeWidth={2.5} />
        <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-white font-bold text-xl tabular-nums">{value.toLocaleString("pt-BR")}</div>
      {sub && <div className="text-slate-500 text-[10px] mt-0.5">{sub}</div>}
    </div>
  );
}
