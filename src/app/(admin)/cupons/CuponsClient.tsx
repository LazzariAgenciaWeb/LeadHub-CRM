"use client";

import { useEffect, useState } from "react";
import {
  Ticket, Plus, Trash2, Loader2, Check, X, Power, Calendar, Percent, DollarSign,
} from "lucide-react";
import { PLAN_ORDER, PLANS, formatPriceBRL, type PlanTier } from "@/lib/plans";

interface Coupon {
  id: string;
  code: string;
  label: string | null;
  discountType: "PERCENT" | "FIXED";
  discountValue: number;
  recurring: boolean;
  validFrom: string | null;
  validUntil: string | null;
  maxUses: number | null;
  usedCount: number;
  appliesToPlans: string[];
  active: boolean;
  createdAt: string;
  _count: { redemptions: number };
}

export default function CuponsClient() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/coupons");
      if (r.ok) setCoupons((await r.json()).coupons);
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(c: Coupon) {
    await fetch(`/api/admin/coupons/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !c.active }),
    });
    void load();
  }

  async function remove(c: Coupon) {
    if (!confirm(`Excluir o cupom ${c.code}?`)) return;
    await fetch(`/api/admin/coupons/${c.id}`, { method: "DELETE" });
    void load();
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2.5">
          <Ticket className="w-5 h-5 text-pink-400" strokeWidth={2.25} />
          <div>
            <h1 className="text-white font-bold text-lg">Cupons promocionais</h1>
            <p className="text-slate-500 text-xs">Descontos aplicáveis no checkout dos planos</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold"
        >
          <Plus className="w-4 h-4" /> Novo cupom
        </button>
      </div>

      {loading ? (
        <div className="p-10 text-center text-slate-500 text-sm">
          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Carregando…
        </div>
      ) : coupons.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-[#1e2d45] rounded-xl">
          <Ticket className="w-10 h-10 text-slate-700 mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-slate-400 text-sm font-medium mb-1">Nenhum cupom criado</p>
          <p className="text-slate-600 text-xs">Crie descontos pra usar em campanhas de lançamento.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {coupons.map((c) => (
            <div key={c.id} className={`bg-[#0a1220] border rounded-xl p-4 ${c.active ? "border-[#1e2d45]" : "border-[#1e2d45]/50 opacity-60"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-white text-sm bg-white/5 px-2 py-0.5 rounded">{c.code}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      c.discountType === "PERCENT" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
                    }`}>
                      {c.discountType === "PERCENT" ? `${c.discountValue}% OFF` : `${formatPriceBRL(c.discountValue)} OFF`}
                    </span>
                    {c.recurring && (
                      <span className="text-[10px] text-violet-300 bg-violet-500/15 px-1.5 py-0.5 rounded uppercase font-bold">Vitalício</span>
                    )}
                    {!c.active && (
                      <span className="text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded uppercase font-bold">Inativo</span>
                    )}
                  </div>
                  {c.label && <p className="text-slate-400 text-xs mt-1">{c.label}</p>}
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-600 flex-wrap">
                    <span>{c.usedCount}{c.maxUses ? `/${c.maxUses}` : ""} usos</span>
                    {c.validUntil && <span>· até {new Date(c.validUntil).toLocaleDateString("pt-BR")}</span>}
                    {c.appliesToPlans.length > 0 && (
                      <span>· planos: {c.appliesToPlans.map((p) => PLANS[p as PlanTier]?.label ?? p).join(", ")}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => toggleActive(c)} className="p-1.5 text-slate-500 hover:text-emerald-400 hover:bg-white/5 rounded" title={c.active ? "Desativar" : "Ativar"}>
                    <Power className="w-4 h-4" />
                  </button>
                  <button onClick={() => remove(c)} className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded" title="Excluir">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && <CouponForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); void load(); }} />}
    </div>
  );
}

function CouponForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [discountType, setDiscountType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [discountValue, setDiscountValue] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [validUntil, setValidUntil] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [appliesToPlans, setAppliesToPlans] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const r = await fetch("/api/admin/coupons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code, label: label || null, discountType,
        discountValue, recurring,
        validUntil: validUntil || null,
        maxUses: maxUses || null,
        appliesToPlans,
      }),
    });
    setSaving(false);
    if (!r.ok) { setError((await r.json()).error || "Erro"); return; }
    onSaved();
  }

  function togglePlan(tier: string) {
    setAppliesToPlans((prev) => prev.includes(tier) ? prev.filter((t) => t !== tier) : [...prev, tier]);
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0d1525] border border-[#1e2d45] rounded-2xl p-5 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-white font-bold text-base mb-4 flex items-center gap-2">
          <Ticket className="w-4 h-4 text-pink-400" /> Novo cupom
        </h3>
        {error && <div className="mb-3 p-2 rounded bg-red-500/10 border border-red-500/30 text-red-300 text-xs">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-slate-400 text-[11px] font-semibold mb-1">Código*</label>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="LANCAMENTO50"
              className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-slate-600" autoFocus />
          </div>
          <div>
            <label className="block text-slate-400 text-[11px] font-semibold mb-1">Descrição interna</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Campanha de lançamento"
              className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 text-[11px] font-semibold mb-1">Tipo</label>
              <select value={discountType} onChange={(e) => setDiscountType(e.target.value as any)}
                className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white">
                <option value="PERCENT">Percentual (%)</option>
                <option value="FIXED">Valor fixo (R$)</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 text-[11px] font-semibold mb-1">
                {discountType === "PERCENT" ? "Desconto %" : "Desconto R$"}
              </label>
              <input type="number" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === "PERCENT" ? "30" : "50"}
                className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 text-[11px] font-semibold mb-1">Válido até (opcional)</label>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)}
                className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs text-white" />
            </div>
            <div>
              <label className="block text-slate-400 text-[11px] font-semibold mb-1">Máx. usos (opcional)</label>
              <input type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="ilimitado"
                className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-slate-600" />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="accent-indigo-500" />
            <span className="text-slate-300 text-xs">Desconto vitalício (todas as cobranças, não só a 1ª)</span>
          </label>
          <div>
            <label className="block text-slate-400 text-[11px] font-semibold mb-1.5">Restringir a planos (vazio = todos)</label>
            <div className="flex flex-wrap gap-1.5">
              {PLAN_ORDER.map((tier) => (
                <button key={tier} onClick={() => togglePlan(tier)}
                  className={`text-[11px] px-2 py-1 rounded-full border ${
                    appliesToPlans.includes(tier)
                      ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40"
                      : "bg-white/5 text-slate-500 border-[#1e2d45]"
                  }`}>
                  {PLANS[tier].label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={save} disabled={saving || !code || !discountValue}
            className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50">
            {saving ? "Criando…" : "Criar cupom"}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-[#0a1220] border border-[#1e2d45] text-slate-300 text-sm hover:text-white">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
