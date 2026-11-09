"use client";

import { useEffect, useState } from "react";
import { CreditCard, Loader2, Sparkles } from "lucide-react";

// Plano da Página no topo do editor: no Grátis, assinar Pro ou Mini Site (checkout
// da Stripe); nos pagos, abrir o portal (cartão, faturas, cancelamento).
// ?assinar=PAGINA_PRO (vindo do botão do site) abre o pagamento sozinho.

export interface PlanoPaginaInfo {
  label: string;
  free: boolean;
  /** Já paga pela Stripe: tem portal pra gerenciar. */
  manage: boolean;
  offers: { tier: string; label: string; price: number; annualTotal: number }[];
  /** Anual pago no Pix: até quando vale e qual plano renovar. */
  pix?: { until: string; tier: string; total: number } | null;
}

const brl = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

export default function PlanoPagina({ plan }: { plan: PlanoPaginaInfo }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function go(path: string, body: unknown, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.url) {
        window.location.assign(j.url);
        return;
      }
      setError(
        res.status === 503
          ? "O pagamento online ainda não está ativo. Fale com a gente pelo WhatsApp para assinar."
          : j.error ?? "Não deu para abrir o pagamento agora. Tente de novo.",
      );
    } catch {
      setError("Sem conexão. Tente de novo.");
    }
    setBusy(null);
  }

  const subscribe = (tier: string) => go("/api/billing/checkout", { tier, cycle: "monthly" }, tier);
  const payPix = (tier: string) => go("/api/billing/checkout", { tier, cycle: "annual", method: "pix" }, `pix-${tier}`);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const assinatura = q.get("assinatura");
    const assinar = q.get("assinar");
    if (!assinatura && !assinar) return;
    // Fora do ciclo do efeito; o cleanup cancela a 1ª execução do modo dev.
    const t = setTimeout(() => {
      window.history.replaceState(null, "", window.location.pathname);
      if (assinatura === "ok") setNotice("Pagamento recebido! Seu plano é atualizado em instantes. Se ainda aparecer Grátis, recarregue a página daqui a pouco.");
      if (assinatura === "cancelada") setNotice("O pagamento não foi concluído. Você pode assinar quando quiser.");
      if (assinar && plan.free && plan.offers.some((o) => o.tier === assinar)) void subscribe(assinar);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="mb-5 rounded-xl border border-[#1e2d45] bg-[#0f1623] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-500">Seu plano</p>
          <p className="text-white font-semibold">{plan.label}</p>
        </div>
        {plan.free ? (
          <div className="flex flex-wrap gap-2">
            {plan.offers.map((o, i) => (
              <button
                key={o.tier}
                type="button"
                disabled={!!busy}
                onClick={() => subscribe(o.tier)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-60 ${i === 0 ? "bg-fuchsia-600 text-white hover:bg-fuchsia-500" : "border border-[#2a3a55] text-slate-200 hover:bg-[#161f30]"}`}
              >
                {busy === o.tier ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : i === 0 ? <Sparkles className="h-3.5 w-3.5" /> : null}
                Assinar {o.label} · {brl(o.price)}/mês
              </button>
            ))}
          </div>
        ) : plan.manage ? (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => go("/api/billing/portal", {}, "portal")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#2a3a55] px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-[#161f30] disabled:opacity-60"
          >
            {busy === "portal" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
            Gerenciar assinatura
          </button>
        ) : null}
      </div>
      {plan.free && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
          <span>Prefere Pix? 12 meses à vista:</span>
          {plan.offers.map((o) => (
            <button key={o.tier} type="button" disabled={!!busy} onClick={() => payPix(o.tier)} className="font-semibold text-fuchsia-300 underline underline-offset-2 disabled:opacity-60">
              {busy === `pix-${o.tier}` ? "Abrindo…" : `${o.label} · ${brl(o.annualTotal)}`}
            </button>
          ))}
        </div>
      )}
      {plan.pix && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <span>Anual no Pix, válido até {new Date(plan.pix.until).toLocaleDateString("pt-BR")}. O Pix não renova sozinho.</span>
          <button type="button" disabled={!!busy} onClick={() => payPix(plan.pix!.tier)} className="font-semibold text-fuchsia-300 underline underline-offset-2 disabled:opacity-60">
            {busy?.startsWith("pix-") ? "Abrindo…" : `Renovar no Pix · ${brl(plan.pix.total)}`}
          </button>
        </div>
      )}
      {plan.free && (
        <p className="mt-2 text-xs text-slate-500">
          No Pro a página fica sem a marca GoHub, com formulário, agenda, serviços com imagem e todos os contatos com as respostas.
        </p>
      )}
      {notice && <p className="mt-2 text-xs text-emerald-300">{notice}</p>}
      {error && <p className="mt-2 text-xs text-amber-300">{error}</p>}
    </section>
  );
}
