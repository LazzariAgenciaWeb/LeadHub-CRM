"use client";

import { TrendingDown, Award, XCircle } from "lucide-react";

type Stage = { key: string; label: string; value: number };

export default function MarketingFunnel({
  funnel,
}: {
  funnel: {
    profile: "basico" | "captacao" | "completo";
    stages: Stage[];
    won: number | null;
    lost: number | null;
  };
}) {
  const { stages, won, lost, profile } = funnel;
  const max = Math.max(...stages.map((s) => s.value), 1);

  const profileLabel =
    profile === "completo" ? "Funil completo (Marketing + CRM + Oportunidades)"
    : profile === "captacao" ? "Funil de captação (Marketing + Prospecção)"
    : "Funil básico (somente Marketing)";

  return (
    <div className="bg-[#0a1220]/60 border border-[#1e2d45] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-indigo-400" strokeWidth={2.25} />
          <h3 className="text-white font-bold text-sm">Funil de conversão</h3>
        </div>
        <span className="text-slate-500 text-[11px]">{profileLabel}</span>
      </div>

      <div className="space-y-2">
        {stages.map((stage, i) => {
          const widthPct = Math.max(8, (stage.value / max) * 100);
          const next = stages[i + 1];
          const dropPct = next && stage.value > 0
            ? Math.round(((stage.value - next.value) / stage.value) * 100)
            : null;

          return (
            <div key={stage.key}>
              <div className="flex items-center gap-3">
                <div className="w-32 shrink-0 text-slate-400 text-xs">{stage.label}</div>
                <div className="flex-1 relative">
                  <div
                    className="h-7 bg-gradient-to-r from-indigo-500/40 to-cyan-500/40 border border-indigo-400/30 rounded flex items-center px-3"
                    style={{ width: `${widthPct}%` }}
                  >
                    <span className="text-white text-xs font-semibold tabular-nums">
                      {stage.value.toLocaleString("pt-BR")}
                    </span>
                  </div>
                </div>
              </div>
              {next && dropPct !== null && dropPct > 0 && (
                <div className="flex items-center gap-3 mt-0.5 mb-1">
                  <div className="w-32 shrink-0" />
                  <div className="text-slate-500 text-[10px]">
                    queda de {dropPct}% pra próximo estágio
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(won !== null || lost !== null) && (
        <div className="mt-5 pt-4 border-t border-[#1e2d45] grid grid-cols-2 gap-3">
          <div className="flex items-center gap-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
            <Award className="w-5 h-5 text-emerald-400" />
            <div>
              <div className="text-emerald-300 text-[10px] font-bold uppercase tracking-wide">Ganho</div>
              <div className="text-white font-bold text-lg">{(won ?? 0).toLocaleString("pt-BR")}</div>
            </div>
          </div>
          <div className="flex items-center gap-3 bg-red-500/5 border border-red-500/20 rounded-lg p-3">
            <XCircle className="w-5 h-5 text-red-400" />
            <div>
              <div className="text-red-300 text-[10px] font-bold uppercase tracking-wide">Perdido</div>
              <div className="text-white font-bold text-lg">{(lost ?? 0).toLocaleString("pt-BR")}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
