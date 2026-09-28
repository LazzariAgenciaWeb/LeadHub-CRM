import { fmtUSD, type AiSpend } from "@/lib/ai-costs-format";

/**
 * Cartão de consumo de IA (hoje / 7 dias / mês + por modelo). Saldo da conta
 * não existe por API — por isso os links pro billing de cada provedor.
 */
export default function AiSpendCard({ spend, title = "💸 Consumo de IA (estimado)", compact = false }: { spend: AiSpend; title?: string; compact?: boolean }) {
  return (
    <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[#1e2d45] flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-white font-bold text-sm">{title}</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Calculado pelos tokens de cada chamada × preço de tabela do modelo. Saldo da conta só no site do provedor:{" "}
            <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">OpenAI</a>
            {" · "}
            <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Anthropic</a>
          </p>
        </div>
      </div>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Hoje", value: spend.todayUSD, sub: `${spend.todayCalls} chamada${spend.todayCalls === 1 ? "" : "s"}` },
            { label: "7 dias", value: spend.weekUSD, sub: "" },
            { label: "Este mês", value: spend.monthUSD, sub: `${spend.monthCalls} chamada${spend.monthCalls === 1 ? "" : "s"}` },
          ].map((k) => (
            <div key={k.label} className="bg-[#131c2c] border border-[#1e2d45] rounded-lg px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">{k.label}</div>
              <div className="text-white font-bold text-base tabular-nums">{fmtUSD(k.value)}</div>
              {k.sub && <div className="text-[10px] text-slate-500">{k.sub}</div>}
            </div>
          ))}
        </div>
        {!compact && spend.byModelMonth.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">Por modelo (mês)</div>
            <div className="space-y-1">
              {spend.byModelMonth.map((r) => (
                <div key={r.model} className="flex items-center gap-3 text-xs px-3 py-1.5 rounded-lg bg-[#131c2c]">
                  <span className="font-mono text-slate-200 flex-1 truncate">{r.model}</span>
                  <span className="text-slate-500 tabular-nums">{r.calls}× · {((r.tokensIn + r.tokensOut) / 1000).toFixed(0)}k tok</span>
                  <span className={`tabular-nums font-semibold ${r.costUSD === null ? "text-amber-400" : "text-white"}`}>{r.costUSD === null ? "sem preço" : fmtUSD(r.costUSD)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {spend.unpriced.length > 0 && (
          <p className="text-[10px] text-amber-400/80">Modelo(s) sem preço na tabela: {spend.unpriced.join(", ")} — o gasto deles não entra na soma.</p>
        )}
      </div>
    </section>
  );
}
