"use client";

import { useEffect, useState } from "react";
import {
  CreditCard, AlertCircle, Check, Save, Sparkles, Loader2,
  Settings2, Info,
} from "lucide-react";

type PlanTier = "FREE" | "TRIAL" | "ESSENCIAL" | "MARKETING" | "CRESCIMENTO" | "PREMIUM" | "ENTERPRISE";
type Status = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "UNPAID" | "INCOMPLETE";

interface PlanLimits {
  whatsappInstances: number;
  atendentes: number;
  unidades: number;
  leadsPerMonth: number;
}

interface PlanFeatures {
  crmBasico: boolean; crmAvancado: boolean; inboxAvancado: boolean;
  marketingDashboard: boolean; googleAnalytics: boolean; googleSearchConsole: boolean;
  googleBusinessProfile: boolean; googleAds: boolean; metaAds: boolean;
  cofreCredenciais: boolean; magicLink: boolean; tickets: boolean;
  assistenteIA: boolean; multiUnidade: boolean; bannerLgpd: boolean;
  apiAccess: boolean; whiteLabel: boolean; customDomain: boolean;
  suportePrioritario: boolean; accountManager: boolean;
}

interface SubscriptionData {
  subscription: {
    id: string;
    plan: PlanTier;
    status: Status;
    billingCycle: string;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    customLimits: Partial<PlanLimits> | null;
    customFeatures: Partial<PlanFeatures> | null;
    customNotes: string | null;
  } | null;
  planDefaults: {
    label: string;
    limits: PlanLimits;
    features: PlanFeatures;
  };
  effective: {
    tier: PlanTier;
    limits: PlanLimits;
    features: PlanFeatures;
    hasCustomOverrides: boolean;
  };
  plans: Record<PlanTier, { label: string; limits: PlanLimits; features: PlanFeatures }>;
}

const ALL_PLANS: PlanTier[] = ["FREE", "TRIAL", "ESSENCIAL", "MARKETING", "CRESCIMENTO", "PREMIUM", "ENTERPRISE"];
const STATUSES: Status[] = ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "UNPAID", "INCOMPLETE"];

const FEATURE_LABELS: Record<keyof PlanFeatures, string> = {
  crmBasico: "CRM básico",
  crmAvancado: "CRM avançado",
  inboxAvancado: "Inbox avançado",
  marketingDashboard: "Dashboard Marketing",
  googleAnalytics: "Google Analytics",
  googleSearchConsole: "Search Console",
  googleBusinessProfile: "Google Meu Negócio",
  googleAds: "Google Ads",
  metaAds: "Meta Ads",
  cofreCredenciais: "Cofre",
  magicLink: "Magic Link",
  tickets: "Tickets",
  assistenteIA: "Assistente IA",
  multiUnidade: "Multi-unidade",
  bannerLgpd: "Banner LGPD",
  apiAccess: "API",
  whiteLabel: "White-label",
  customDomain: "Domínio próprio",
  suportePrioritario: "Suporte prioritário",
  accountManager: "Account manager",
};

const LIMIT_LABELS: Record<keyof PlanLimits, string> = {
  whatsappInstances: "WhatsApp instâncias",
  atendentes: "Atendentes",
  unidades: "Unidades / Filiais",
  leadsPerMonth: "Leads / mês",
};

export default function CompanySubscription({ companyId }: { companyId: string }) {
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Form state
  const [plan, setPlan] = useState<PlanTier>("FREE");
  const [status, setStatus] = useState<Status>("ACTIVE");
  const [trialEndsAt, setTrialEndsAt] = useState("");
  const [customNotes, setCustomNotes] = useState("");
  const [customLimits, setCustomLimits] = useState<Partial<Record<keyof PlanLimits, string>>>({});
  const [customFeatures, setCustomFeatures] = useState<Partial<PlanFeatures>>({});

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/companies/${companyId}/subscription`);
      if (!r.ok) throw new Error((await r.json()).error || "Erro");
      const j: SubscriptionData = await r.json();
      setData(j);
      if (j.subscription) {
        setPlan(j.subscription.plan);
        setStatus(j.subscription.status);
        setTrialEndsAt(j.subscription.trialEndsAt ? j.subscription.trialEndsAt.slice(0, 10) : "");
        setCustomNotes(j.subscription.customNotes ?? "");
        const cl: Partial<Record<keyof PlanLimits, string>> = {};
        for (const k of Object.keys(j.subscription.customLimits ?? {}) as (keyof PlanLimits)[]) {
          cl[k] = String((j.subscription.customLimits as any)[k]);
        }
        setCustomLimits(cl);
        setCustomFeatures(j.subscription.customFeatures ?? {});
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setFlash(null);
    try {
      // Limpa overrides vazios — se valor for igual ao default do plano, não salva
      const planDefault = data?.plans[plan];
      const limitsToSave: Partial<PlanLimits> = {};
      for (const [k, v] of Object.entries(customLimits)) {
        if (v === "" || v === null || v === undefined) continue;
        const n = parseInt(v, 10);
        if (isNaN(n)) continue;
        if (planDefault && n === (planDefault.limits as any)[k]) continue; // == default → não salva
        (limitsToSave as any)[k] = n;
      }
      const featuresToSave: Partial<PlanFeatures> = {};
      for (const [k, v] of Object.entries(customFeatures)) {
        if (v === undefined || v === null) continue;
        if (planDefault && v === (planDefault.features as any)[k]) continue; // == default → não salva
        (featuresToSave as any)[k] = v;
      }

      const r = await fetch(`/api/admin/companies/${companyId}/subscription`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          status,
          trialEndsAt: trialEndsAt || null,
          customLimits: Object.keys(limitsToSave).length > 0 ? limitsToSave : null,
          customFeatures: Object.keys(featuresToSave).length > 0 ? featuresToSave : null,
          customNotes: customNotes || null,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Falha ao salvar");
      setFlash("Plano atualizado!");
      void load();
      setTimeout(() => setFlash(null), 3000);
    } catch (e: any) {
      setFlash("Erro: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-10 text-center text-slate-500 text-sm">
        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
        Carregando…
      </div>
    );
  }
  if (error) return <div className="p-10 text-center text-red-400 text-sm">{error}</div>;
  if (!data) return null;

  const planDefault = data.plans[plan];

  return (
    <div className="p-5 space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <CreditCard className="w-5 h-5 text-amber-400" strokeWidth={2.25} />
        <div>
          <h2 className="text-white font-bold text-sm">Plano e Assinatura</h2>
          <p className="text-slate-500 text-[11px]">
            Apenas super admin. Define plano + overrides personalizados de limite e features.
          </p>
        </div>
      </div>

      {flash && (
        <div className={`p-3 rounded-lg flex items-center gap-2 text-xs ${
          flash.startsWith("Erro")
            ? "bg-red-500/10 border border-red-500/30 text-red-300"
            : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
        }`}>
          <Check className="w-4 h-4" />
          {flash}
        </div>
      )}

      {/* Plano + status */}
      <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-400 text-[11px] font-semibold mb-1">Plano</label>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value as PlanTier)}
              className="w-full bg-[#070b14] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white"
            >
              {ALL_PLANS.map((p) => (
                <option key={p} value={p}>{data.plans[p].label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-slate-400 text-[11px] font-semibold mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
              className="w-full bg-[#070b14] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-slate-400 text-[11px] font-semibold mb-1">
              Trial expira em (opcional)
            </label>
            <input
              type="date"
              value={trialEndsAt}
              onChange={(e) => setTrialEndsAt(e.target.value)}
              className="w-full bg-[#070b14] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
        </div>
        <div>
          <label className="block text-slate-400 text-[11px] font-semibold mb-1">Anotação interna</label>
          <input
            type="text"
            value={customNotes}
            onChange={(e) => setCustomNotes(e.target.value)}
            placeholder="ex: Cliente parceiro Lazzari, lifetime deal"
            className="w-full bg-[#070b14] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs text-white"
          />
        </div>
      </div>

      {/* Overrides de limite */}
      <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Settings2 className="w-4 h-4 text-indigo-400" strokeWidth={2.25} />
          <h3 className="text-white text-sm font-semibold">Limites personalizados</h3>
          <span className="text-[10px] text-slate-600 bg-white/5 px-1.5 py-0.5 rounded">
            Vazio = usa o default do plano
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(Object.keys(LIMIT_LABELS) as (keyof PlanLimits)[]).map((key) => {
            const def = (planDefault?.limits as any)[key];
            return (
              <div key={key}>
                <label className="block text-slate-400 text-[11px] font-medium mb-1">
                  {LIMIT_LABELS[key]}
                  <span className="text-slate-600 text-[10px] ml-1">
                    (default: {def === -1 ? "ilimitado" : def})
                  </span>
                </label>
                <input
                  type="number"
                  value={customLimits[key] ?? ""}
                  onChange={(e) => setCustomLimits({ ...customLimits, [key]: e.target.value })}
                  placeholder={String(def)}
                  className="w-full bg-[#070b14] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                />
                <p className="text-[10px] text-slate-700 mt-0.5">-1 = ilimitado</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Overrides de features */}
      <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-emerald-400" strokeWidth={2.25} />
          <h3 className="text-white text-sm font-semibold">Features personalizadas</h3>
          <span className="text-[10px] text-slate-600 bg-white/5 px-1.5 py-0.5 rounded">
            Toggle só se quiser sobrescrever o default
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {(Object.keys(FEATURE_LABELS) as (keyof PlanFeatures)[]).map((key) => {
            const def = (planDefault?.features as any)[key];
            const override = customFeatures[key];
            const isOverridden = override !== undefined;
            const effective = isOverridden ? override : def;
            return (
              <div key={key} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-white/[0.02]">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs">{FEATURE_LABELS[key]}</p>
                  <p className="text-[10px] text-slate-600">
                    Default: <span className={def ? "text-emerald-500" : "text-slate-600"}>{def ? "ON" : "OFF"}</span>
                    {isOverridden && (
                      <span className="ml-1 text-amber-400">· OVERRIDE: {override ? "ON" : "OFF"}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const next = { ...customFeatures };
                      if (effective === true) {
                        next[key] = false;
                      } else {
                        next[key] = true;
                      }
                      setCustomFeatures(next);
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      effective ? "bg-emerald-500/20 text-emerald-300" : "bg-white/5 text-slate-500"
                    }`}
                  >
                    {effective ? "ON" : "OFF"}
                  </button>
                  {isOverridden && (
                    <button
                      onClick={() => {
                        const next = { ...customFeatures };
                        delete next[key];
                        setCustomFeatures(next);
                      }}
                      className="text-[10px] text-slate-600 hover:text-slate-400"
                      title="Remover override (volta ao default do plano)"
                    >
                      ↺
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Resumo do efetivo */}
      <div className="bg-indigo-500/5 border border-indigo-500/30 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Info className="w-4 h-4 text-indigo-400" />
          <h3 className="text-white text-sm font-semibold">Efetivo (após overrides)</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          {(Object.keys(data.effective.limits) as (keyof PlanLimits)[]).map((k) => (
            <div key={k} className="bg-[#070b14] border border-[#1e2d45] rounded px-2 py-1.5">
              <p className="text-slate-500 text-[10px]">{LIMIT_LABELS[k]}</p>
              <p className="text-white font-mono">{data.effective.limits[k] === -1 ? "∞" : data.effective.limits[k]}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Salvar */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full md:w-auto flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm px-5 py-2.5 rounded-lg disabled:opacity-50"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saving ? "Salvando…" : "Salvar plano e overrides"}
      </button>
    </div>
  );
}
