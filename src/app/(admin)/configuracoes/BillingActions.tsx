"use client";

import { useState } from "react";
import { CreditCard, ExternalLink, Loader2, Check } from "lucide-react";
import { PLANS, PLAN_ORDER, formatPriceBRL, type PlanTier } from "@/lib/plans";

/**
 * Contratação e cobrança — o que faltava pro ADMIN resolver sozinho.
 *
 * Antes a aba Plano era só leitura ("mudança passa por solicitação ao
 * suporte"). Agora:
 *   - sem assinatura na Stripe → escolhe plano e ciclo, vai pro Checkout
 *   - com assinatura           → Portal da Stripe (cartão, faturas, cancelar)
 *
 * Nenhum dado de cartão passa por aqui: as duas telas são hospedadas pela
 * Stripe. Trocar de plano também acontece lá dentro, e volta por webhook.
 */
export default function BillingActions({
  currentTier, hasStripeCustomer, billingCycle,
}: {
  currentTier: PlanTier;
  hasStripeCustomer: boolean;
  billingCycle: string;
}) {
  const [cycle, setCycle] = useState<"monthly" | "annual">(
    billingCycle === "annual" ? "annual" : "monthly"
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sellable = PLAN_ORDER.filter((t) => t !== "FREE" && PLANS[t].priceMonthly > 0);

  async function checkout(tier: PlanTier) {
    setBusy(tier);
    setError(null);
    try {
      const r = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, cycle }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Falha ao iniciar a contratação");
      window.location.href = j.url;
    } catch (e: any) {
      setError(e.message);
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy("portal");
    setError(null);
    try {
      const r = await fetch("/api/billing/portal", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Falha ao abrir o portal");
      window.location.href = j.url;
    } catch (e: any) {
      setError(e.message);
      setBusy(null);
    }
  }

  return (
    <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <CreditCard className="w-4 h-4 text-indigo-400" strokeWidth={2.25} />
        <h3 className="text-white text-sm font-semibold">Cobrança</h3>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/5 p-2.5 text-xs text-red-300">
          {error}
        </div>
      )}

      {hasStripeCustomer ? (
        <>
          <p className="text-slate-400 text-xs mb-3">
            Cartão, faturas, recibos e cancelamento ficam no portal da Stripe. Trocar de plano
            também é por lá — o sistema recebe a mudança sozinho.
          </p>
          <button
            onClick={openPortal}
            disabled={busy === "portal"}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy === "portal" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
            Gerenciar cobrança
          </button>
        </>
      ) : (
        <>
          <p className="text-slate-400 text-xs mb-3">
            Escolha o plano para contratar. O pagamento é processado pela Stripe.
          </p>

          {/* Ciclo */}
          <div className="inline-flex rounded-lg border border-[#1e2d45] p-0.5 mb-3">
            {(["monthly", "annual"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCycle(c)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  cycle === c ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                {c === "monthly" ? "Mensal" : "Anual"}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {sellable.map((tier) => {
              const plan = PLANS[tier];
              const isCurrent = tier === currentTier;
              const price = cycle === "annual" ? plan.priceAnnualPerMonth : plan.priceMonthly;
              return (
                <div
                  key={tier}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[#1e2d45] bg-[#070b14] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-white text-xs font-semibold flex items-center gap-1.5">
                      {plan.label}
                      {isCurrent && (
                        <span className="text-[9px] text-emerald-300 bg-emerald-500/15 px-1.5 py-0.5 rounded-full font-bold">
                          <Check className="w-2.5 h-2.5 inline" /> atual
                        </span>
                      )}
                    </p>
                    <p className="text-slate-500 text-[10px]">
                      {formatPriceBRL(price)}/mês
                      {cycle === "annual" && ` · ${formatPriceBRL(plan.priceAnnualTotal)} no ano`}
                    </p>
                  </div>
                  <button
                    onClick={() => checkout(tier)}
                    disabled={busy !== null}
                    className="flex-shrink-0 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                  >
                    {busy === tier ? <Loader2 className="w-3 h-3 animate-spin" /> : "Contratar"}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
