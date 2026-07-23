"use client";

import { useEffect, useState } from "react";
import {
  CreditCard, AlertCircle, Check, Save, Sparkles, Loader2,
  Settings2, Info, ChevronDown, ChevronRight, Tag,
} from "lucide-react";
import {
  PLANS,
  findAddonForFeature,
  formatPriceBRL,
  type PlanTier,
  type PlanLimits,
  type PlanFeatures,
} from "@/lib/plans";
import {
  moduleSyncFromTier,
  diffModuleSync,
  MODULE_LABELS,
  type CompanyModuleSync,
} from "@/lib/plans-sync";

type Status = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "UNPAID" | "INCOMPLETE";

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
  /** Estado atual dos Company.module* — pra computar diff ao trocar plano. */
  currentModules?: Partial<CompanyModuleSync>;
}

const PUBLIC_PLANS: PlanTier[] = ["FREE", "ORGANIZATION", "ESSENCIAL", "MARKETING", "PREMIUM"];
const INTERNAL_PLANS: PlanTier[] = ["ENTERPRISE"];
const LEGACY_PLANS: PlanTier[] = ["TRIAL", "CRESCIMENTO"];
const STATUSES: Status[] = ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "UNPAID", "INCOMPLETE"];

const LIMIT_LABELS: Record<keyof PlanLimits, string> = {
  whatsappInstances: "WhatsApp instâncias",
  atendentes: "Atendentes",
  unidades: "Unidades / Filiais",
  leadsPerMonth: "Leads / mês",
};

// ─── Features agrupadas por categoria (5 acordeões) ─────────────────────────
interface FeatureRow {
  key: keyof PlanFeatures;
  label: string;
}
interface FeatureGroup {
  id: string;
  title: string;
  icon: string;
  features: FeatureRow[];
}

// Grupos alinhados à MESMA jornada do menu (Sidebar) e dos toggles de módulo:
// Atrair → Atender → Vender → Analisar → Gestão → Sistema. Um vocabulário só
// no sistema inteiro. As back-office (segurança/integrações/enterprise) que não
// são etapa de jornada vão em "Sistema", igual ao grupo Sistema do menu.
const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: "atrair",
    title: "Atrair",
    icon: "📣",
    features: [
      { key: "campanhas",  label: "Campanhas" },
      { key: "links",      label: "Links de rastreio (pixel)" },
      { key: "emailMassa", label: "E-mail Marketing (massa)" },
      { key: "videos",     label: "Biblioteca de vídeos" },
    ],
  },
  {
    id: "atender",
    title: "Atender",
    icon: "💬",
    features: [
      { key: "whatsapp",         label: "WhatsApp (Inbox)" },
      { key: "whatsappGrupos",   label: "Ver grupos no inbox" },
      { key: "inboxAvancado",    label: "Inbox avançado (SLA, transferência)" },
      { key: "socialInbox",      label: "Instagram + Facebook na inbox" },
      { key: "tickets",          label: "Tickets / Chamados" },
      { key: "tarefasInternas",  label: "Tarefas internas" },
      { key: "assistenteIA",     label: "Assistente IA" },
    ],
  },
  {
    id: "vender",
    title: "Vender",
    icon: "🎯",
    features: [
      { key: "crmPipelineLeads",         label: "CRM — Pipeline Leads" },
      { key: "crmPipelineOportunidades", label: "CRM — Pipeline Oportunidades" },
      { key: "crmPipelineProspeccao",    label: "CRM — Pipeline Prospecção" },
      { key: "prospectaIa",              label: "LeadHub Prospecta" },
    ],
  },
  {
    id: "analisar",
    title: "Analisar",
    icon: "📊",
    features: [
      { key: "marketingDashboard",   label: "Dashboard Marketing" },
      { key: "googleAnalytics",      label: "Google Analytics" },
      { key: "googleSearchConsole",  label: "Search Console" },
      { key: "googleBusinessProfile", label: "Google Meu Negócio" },
      { key: "googleAds",            label: "Google Ads" },
      { key: "metaAds",              label: "Meta Ads" },
      { key: "gamificacao",          label: "Gamificação (ranking)" },
    ],
  },
  {
    id: "gestao",
    title: "Gestão",
    icon: "🗂️",
    features: [
      { key: "meuEspaco",        label: "Espaço do Cliente (home do cliente)" },
      { key: "projetos",         label: "Projetos" },
      { key: "calendario",       label: "Calendário" },
      { key: "cofreCredenciais", label: "Cofre de credenciais" },
      { key: "multiUnidade",     label: "Multi-unidade / filiais" },
    ],
  },
  {
    id: "sistema",
    title: "Sistema & Acesso",
    icon: "⚙️",
    features: [
      { key: "magicLink",          label: "Magic Link (login sem senha)" },
      { key: "bannerLgpd",         label: "Banner LGPD" },
      { key: "clickupSync",        label: "ClickUp Sync" },
      { key: "apiAccess",          label: "API completa" },
      { key: "customDomain",       label: "Domínio próprio" },
      { key: "suportePrioritario", label: "Suporte prioritário" },
      { key: "accountManager",     label: "Account manager" },
    ],
  },
];

export default function CompanySubscription({
  companyId,
  readOnly = false,
}: {
  companyId: string;
  // readOnly = ADMIN da própria empresa — vê plano atual + features, sem editar.
  // Só SUPER_ADMIN edita plano/limites/features. Mudanças passam por solicitação.
  readOnly?: boolean;
}) {
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

  // Acordeão das categorias — começa tudo aberto
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    Object.fromEntries(FEATURE_GROUPS.map((g) => [g.id, true]))
  );

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
        setTrialEndsAt(j.subscription.trialEndsAt ? new Date(j.subscription.trialEndsAt).toISOString().slice(0, 10) : "");
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

  // Trocar de plano: recarrega os toggles/limites com os defaults do novo
  // plano (limpa overrides). Se havia overrides personalizados, confirma antes
  // pra não apagar sem querer.
  function handleChangePlan(newPlan: PlanTier) {
    if (newPlan === plan) return;
    const hadOverrides =
      Object.keys(customFeatures).length > 0 ||
      Object.values(customLimits).some((v) => v !== "" && v != null);
    if (hadOverrides) {
      const ok = window.confirm(
        "Trocar de plano vai recarregar os limites e as features com os padrões do novo plano, descartando os overrides atuais. Continuar?"
      );
      if (!ok) return;
    }
    setPlan(newPlan);
    setCustomFeatures({});
    setCustomLimits({});
  }

  async function handleSave() {
    setSaving(true);
    setFlash(null);
    try {
      const planDefault = data?.plans[plan];
      const limitsToSave: Partial<PlanLimits> = {};
      for (const [k, v] of Object.entries(customLimits)) {
        if (v === "" || v === null || v === undefined) continue;
        const n = parseInt(v, 10);
        if (isNaN(n)) continue;
        if (planDefault && n === (planDefault.limits as any)[k]) continue;
        (limitsToSave as any)[k] = n;
      }
      const featuresToSave: Partial<PlanFeatures> = {};
      for (const [k, v] of Object.entries(customFeatures)) {
        if (v === undefined || v === null) continue;
        if (planDefault && v === (planDefault.features as any)[k]) continue;
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

  function toggleGroup(id: string) {
    setOpenGroups((g) => ({ ...g, [id]: !g[id] }));
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

  // ── Modo somente leitura: ADMIN vê o plano sem poder editar ─────────────
  if (readOnly) {
    const eff = data.effective;
    const currentLabel = data.plans[eff.tier]?.label ?? eff.tier;
    const requestPhone = "5544999015088";
    const msg = encodeURIComponent(
      `Olá! Gostaria de solicitar uma mudança no plano da empresa (atualmente: ${currentLabel}). Empresa ID: ${companyId}`
    );
    const requestUrl = `https://wa.me/${requestPhone}?text=${msg}`;

    return (
      <div className="p-5 space-y-5 max-w-3xl">
        <div className="flex items-center gap-2.5">
          <CreditCard className="w-5 h-5 text-amber-400" strokeWidth={2.25} />
          <div>
            <h2 className="text-white font-bold text-sm">Plano e Assinatura</h2>
            <p className="text-slate-500 text-[11px]">
              Plano atual da sua empresa. Para mudar, solicite ao nosso suporte.
            </p>
          </div>
        </div>

        {/* Plano atual */}
        <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 border border-amber-500/30 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <p className="text-amber-300 text-[11px] font-bold uppercase tracking-wider">Plano ativo</p>
          </div>
          <p className="text-white font-bold text-2xl">{currentLabel}</p>
          <p className="text-slate-400 text-xs mt-1">
            Status: <span className="text-emerald-400 font-medium">{data.subscription?.status ?? "ATIVO"}</span>
            {data.subscription?.trialEndsAt && (
              <span className="text-slate-500 ml-3">
                · Trial até {new Date(data.subscription.trialEndsAt).toLocaleDateString("pt-BR")}
              </span>
            )}
          </p>
        </div>

        {/* Limites efetivos */}
        <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
          <h3 className="text-white text-sm font-semibold mb-3 flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-indigo-400" /> Limites do plano
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {(Object.keys(eff.limits) as (keyof PlanLimits)[]).map((k) => (
              <div key={k} className="bg-[#070b14] border border-[#1e2d45] rounded px-3 py-2">
                <p className="text-slate-500 text-[10px]">{LIMIT_LABELS[k]}</p>
                <p className="text-white font-mono text-base">{eff.limits[k] === -1 ? "∞" : eff.limits[k]}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Features ativas — agrupadas */}
        <div className="space-y-3">
          {FEATURE_GROUPS.map((group) => {
            const enabledInGroup = group.features.filter((f) => eff.features[f.key]);
            if (enabledInGroup.length === 0) return null;
            return (
              <div key={group.id} className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
                <h3 className="text-white text-sm font-semibold mb-2 flex items-center gap-2">
                  <span>{group.icon}</span> {group.title}
                  <span className="text-[10px] text-slate-600">({enabledInGroup.length})</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                  {enabledInGroup.map((f) => (
                    <div key={f.key} className="flex items-center gap-2 px-2 py-1 text-xs">
                      <span className="text-emerald-400">✓</span>
                      <span className="text-slate-200">{f.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* CTA solicitar mudança */}
        <div className="bg-indigo-500/5 border border-indigo-500/30 rounded-xl p-5 text-center">
          <Info className="w-5 h-5 text-indigo-400 mx-auto mb-2" />
          <h3 className="text-white text-sm font-semibold mb-1">Quer mudar de plano?</h3>
          <p className="text-slate-400 text-xs mb-4 max-w-md mx-auto">
            Entre em contato com nosso suporte que ajustamos o plano da sua empresa, com o limite e features que você precisa.
          </p>
          <a
            href={requestUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-semibold transition-colors"
          >
            💬 Solicitar mudança de plano
          </a>
        </div>
      </div>
    );
  }

  // ── Modo SUPER_ADMIN: edição completa ────────────────────────────────────
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
              onChange={(e) => handleChangePlan(e.target.value as PlanTier)}
              className="w-full bg-[#070b14] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white"
            >
              <optgroup label="Públicos">
                {PUBLIC_PLANS.map((p) => (
                  <option key={p} value={p}>
                    {data.plans[p].label}
                    {PLANS[p].priceMonthly > 0 ? ` — ${formatPriceBRL(PLANS[p].priceMonthly)}/mês` : " — grátis"}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Interno (atribuição manual)">
                {INTERNAL_PLANS.map((p) => (
                  <option key={p} value={p}>{data.plans[p].label}</option>
                ))}
              </optgroup>
              <optgroup label="Legado">
                {LEGACY_PLANS.map((p) => (
                  <option key={p} value={p}>{data.plans[p].label}</option>
                ))}
              </optgroup>
            </select>
            <p className="text-[10px] text-slate-600 mt-1">
              Modo atendimento default: <span className="text-slate-400 font-mono">{PLANS[plan].modoAtendimentoDefault}</span>
            </p>
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

      {/* Overrides de features — agrupadas em accordion */}
      <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-emerald-400" strokeWidth={2.25} />
          <h3 className="text-white text-sm font-semibold">Features personalizadas</h3>
          <span className="text-[10px] text-slate-600 bg-white/5 px-1.5 py-0.5 rounded">
            Toggle só se quiser sobrescrever o default · 🧩 = add-on (cobrança extra)
          </span>
        </div>

        <div className="space-y-2">
          {FEATURE_GROUPS.map((group) => {
            const isOpen = !!openGroups[group.id];
            const enabledCount = group.features.filter((f) => {
              const def = (planDefault?.features as any)[f.key];
              const override = customFeatures[f.key];
              const effective = override !== undefined ? override : def;
              return effective === true;
            }).length;

            return (
              <div key={group.id} className="border border-[#1e2d45] rounded-lg bg-[#070b14]">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/[0.02]"
                >
                  <div className="flex items-center gap-2 text-xs">
                    {isOpen ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <span>{group.icon}</span>
                    <span className="text-white font-semibold">{group.title}</span>
                    <span className="text-[10px] text-slate-600">
                      {enabledCount}/{group.features.length} ativas
                    </span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-[#1e2d45] px-3 py-2 grid grid-cols-1 md:grid-cols-2 gap-1.5">
                    {group.features.map((f) => {
                      const def = (planDefault?.features as any)[f.key] ?? false;
                      const override = customFeatures[f.key];
                      const isOverridden = override !== undefined;
                      const effective = isOverridden ? override : def;
                      const addon = findAddonForFeature(f.key);
                      const isAddonOverride = isOverridden && override === true && def === false && addon;

                      return (
                        <div key={f.key} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-white/[0.02]">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-white text-xs">{f.label}</p>
                              {addon && def === false && (
                                <span
                                  className="inline-flex items-center gap-0.5 text-[9px] bg-amber-500/15 text-amber-300 px-1.5 py-0.5 rounded-full border border-amber-500/30"
                                  title={`Add-on: ${addon.description}`}
                                >
                                  🧩 {formatPriceBRL(addon.priceMonthly)}/mês
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-600">
                              Default: <span className={def ? "text-emerald-500" : "text-slate-600"}>{def ? "ON" : "OFF"}</span>
                              {isOverridden && (
                                <span className="ml-1 text-amber-400">
                                  · OVERRIDE: {override ? "ON" : "OFF"}
                                  {isAddonOverride && " (cobrar add-on)"}
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                const next = { ...customFeatures };
                                next[f.key] = effective === true ? false : true;
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
                                  delete next[f.key];
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
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Resumo de add-ons ativados como override */}
      {(() => {
        const activeAddons: { label: string; priceMonthly: number }[] = [];
        for (const [k, v] of Object.entries(customFeatures)) {
          if (v !== true) continue;
          const def = (planDefault?.features as any)[k];
          if (def === true) continue; // não é override pra ligar — já vem no plano
          const addon = findAddonForFeature(k as keyof PlanFeatures);
          if (addon) activeAddons.push({ label: addon.label, priceMonthly: addon.priceMonthly });
        }
        if (activeAddons.length === 0) return null;
        const total = activeAddons.reduce((sum, a) => sum + a.priceMonthly, 0);
        return (
          <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Tag className="w-4 h-4 text-amber-400" />
              <h3 className="text-white text-sm font-semibold">Add-ons ativos (cobrança extra)</h3>
            </div>
            <ul className="text-xs text-slate-300 space-y-1 mb-2">
              {activeAddons.map((a) => (
                <li key={a.label} className="flex justify-between">
                  <span>🧩 {a.label}</span>
                  <span className="text-amber-300 font-mono">{formatPriceBRL(a.priceMonthly)}/mês</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between text-xs border-t border-amber-500/20 pt-2 mt-2">
              <span className="text-slate-400">Total add-ons</span>
              <span className="text-amber-300 font-bold">{formatPriceBRL(total)}/mês</span>
            </div>
          </div>
        );
      })()}

      {/* Preview do sync com Company.module* — só aparece quando plano mudou */}
      {(() => {
        const originalPlan = data.subscription?.plan;
        const planJustChanged = originalPlan && originalPlan !== plan;
        if (!planJustChanged) return null;
        const next = moduleSyncFromTier(plan);
        const diff = diffModuleSync(data.currentModules ?? {}, next);
        const hasDiff = diff.willEnable.length > 0 || diff.willDisable.length > 0 || diff.modoChange !== null;
        if (!hasDiff) return null;
        return (
          <div className="bg-purple-500/5 border border-purple-500/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-purple-400" />
              <h3 className="text-white text-sm font-semibold">Ao salvar — módulos vão ser sincronizados</h3>
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              Troca de plano (<span className="text-slate-300 font-mono">{originalPlan}</span> → <span className="text-purple-300 font-mono">{plan}</span>)
              aplica os defaults do plano novo nos módulos da empresa. Você pode customizar depois pelos toggles no Editar Empresa.
            </p>
            {diff.willEnable.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider mb-1">Vão ligar</p>
                <div className="flex flex-wrap gap-1.5">
                  {diff.willEnable.map((m) => (
                    <span key={m} className="text-[11px] bg-emerald-500/15 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
                      + {MODULE_LABELS[m]}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {diff.willDisable.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] text-red-400 font-semibold uppercase tracking-wider mb-1">Vão desligar</p>
                <div className="flex flex-wrap gap-1.5">
                  {diff.willDisable.map((m) => (
                    <span key={m} className="text-[11px] bg-red-500/15 text-red-300 px-2 py-0.5 rounded-full border border-red-500/30">
                      − {MODULE_LABELS[m]}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {diff.modoChange && (
              <div>
                <p className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider mb-1">Modo de atendimento</p>
                <span className="text-[11px] bg-amber-500/15 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30">
                  {diff.modoChange.from} → {diff.modoChange.to}
                </span>
              </div>
            )}
          </div>
        );
      })()}

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
