"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CreditCard, Users, Search, TrendingUp, Settings2, Check, Sparkles,
} from "lucide-react";
import {
  PLANS, PLAN_ORDER, formatPriceBRL,
  type PlanTier, type PlanFeatures, type PlanLimits,
} from "@/lib/plans";

type SubStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "UNPAID" | "INCOMPLETE" | null;

interface Row {
  id: string;
  name: string;
  segment: string | null;
  companyStatus: string;
  plan: PlanTier;
  subStatus: SubStatus;
  billingCycle: string | null;
  trialEndsAt: string | null;
  leads: number;
  users: number;
  whatsappInstances: number;
  lastActivity: string | null;
  createdAt: string;
}

// ─── Helpers de exibição ─────────────────────────────────────────────────────

const PLAN_BADGE: Record<PlanTier, string> = {
  FREE:        "bg-slate-500/15 text-slate-300 border-slate-500/25",
  TRIAL:       "bg-slate-500/15 text-slate-300 border-slate-500/25",
  ESSENCIAL:   "bg-indigo-500/15 text-indigo-300 border-indigo-500/25",
  MARKETING:   "bg-purple-500/15 text-purple-300 border-purple-500/25",
  CRESCIMENTO: "bg-purple-500/15 text-purple-300 border-purple-500/25",
  PREMIUM:     "bg-amber-500/15 text-amber-300 border-amber-500/25",
  ENTERPRISE:  "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ACTIVE:     { label: "Ativo",          cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25" },
  TRIALING:   { label: "Trial",          cls: "bg-blue-500/15 text-blue-300 border-blue-500/25" },
  PAST_DUE:   { label: "Atrasado",       cls: "bg-amber-500/15 text-amber-300 border-amber-500/25" },
  UNPAID:     { label: "Inadimplente",   cls: "bg-red-500/15 text-red-300 border-red-500/25" },
  CANCELED:   { label: "Cancelado",      cls: "bg-red-500/15 text-red-300 border-red-500/25" },
  INCOMPLETE: { label: "Incompleto",     cls: "bg-slate-500/15 text-slate-300 border-slate-500/25" },
};

const LIMIT_LABELS: Record<keyof PlanLimits, string> = {
  whatsappInstances: "WhatsApp",
  atendentes: "Atendentes",
  unidades: "Unidades",
  leadsPerMonth: "Leads/mês",
};

// Labels legíveis de cada feature (pro catálogo). Espelha PlanFeatures.
const FEATURE_LABELS: Record<keyof PlanFeatures, string> = {
  whatsapp: "WhatsApp (Inbox)",
  whatsappGrupos: "Ver grupos no inbox",
  inboxAvancado: "Inbox avançado (SLA, transferência)",
  tickets: "Tickets / Chamados",
  crmPipelineProspeccao: "CRM — Prospecção",
  crmPipelineLeads: "CRM — Leads",
  crmPipelineOportunidades: "CRM — Oportunidades",
  prospectaIa: "LeadHub Prospecta",
  emailMassa: "Email em massa",
  projetos: "Projetos",
  calendario: "Calendário",
  gamificacao: "Gamificação",
  assistenteIA: "Assistente IA",
  campanhas: "Campanhas",
  links: "Links de rastreio",
  marketingDashboard: "Dashboard Marketing",
  googleAnalytics: "Google Analytics",
  googleSearchConsole: "Search Console",
  googleBusinessProfile: "Google Meu Negócio",
  googleAds: "Google Ads",
  metaAds: "Meta Ads",
  cofreCredenciais: "Cofre de credenciais",
  magicLink: "Magic Link",
  bannerLgpd: "Banner LGPD",
  multiUnidade: "Multi-unidade",
  clickupSync: "ClickUp Sync",
  apiAccess: "API completa",
  whiteLabel: "White-label",
  customDomain: "Domínio próprio",
  suportePrioritario: "Suporte prioritário",
  accountManager: "Account manager",
};

function limitFmt(v: number) {
  return v === -1 ? "Ilimitado" : v.toLocaleString("pt-BR");
}

function relativeTime(iso: string | null): { label: string; stale: boolean } {
  if (!iso) return { label: "Nunca", stale: true };
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return { label: "Hoje", stale: false };
  if (days === 1) return { label: "Ontem", stale: false };
  if (days < 7) return { label: `${days} dias atrás`, stale: false };
  if (days < 30) return { label: `${Math.floor(days / 7)} sem atrás`, stale: days > 14 };
  if (days < 365) return { label: `${Math.floor(days / 30)} meses atrás`, stale: true };
  return { label: `${Math.floor(days / 365)} ano(s) atrás`, stale: true };
}

// ─── Componente ──────────────────────────────────────────────────────────────

export default function PlanosClient({ rows }: { rows: Row[] }) {
  const [tab, setTab] = useState<"assinaturas" | "catalogo">("assinaturas");
  const [query, setQuery] = useState("");
  const [planFilter, setPlanFilter] = useState<PlanTier | "ALL">("ALL");

  const kpis = useMemo(() => {
    let pagantes = 0, free = 0, trial = 0, inadimplentes = 0, mrr = 0;
    for (const r of rows) {
      const def = PLANS[r.plan];
      const isPaid = def && def.priceMonthly > 0;
      if (r.subStatus === "TRIALING") trial++;
      if (r.subStatus === "PAST_DUE" || r.subStatus === "UNPAID") inadimplentes++;
      if (!isPaid) free++;
      if (isPaid && r.subStatus === "ACTIVE") {
        pagantes++;
        mrr += r.billingCycle === "annual" ? def.priceAnnualPerMonth : def.priceMonthly;
      }
    }
    return { total: rows.length, pagantes, free, trial, inadimplentes, mrr };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (planFilter !== "ALL" && r.plan !== planFilter) return false;
      if (q && !r.name.toLowerCase().includes(q) && !(r.segment ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, query, planFilter]);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-5">
        <CreditCard className="w-6 h-6 text-indigo-400" strokeWidth={2.25} />
        <div>
          <h1 className="text-white font-bold text-xl">Planos & Assinaturas</h1>
          <p className="text-slate-500 text-sm">Quem está usando o sistema e o que cada plano inclui.</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <KpiCard label="Clientes" value={kpis.total} icon={<Users className="w-4 h-4" />} color="text-white" />
        <KpiCard label="Pagantes" value={kpis.pagantes} icon={<Sparkles className="w-4 h-4" />} color="text-emerald-400" />
        <KpiCard label="No Free" value={kpis.free} color="text-slate-300" />
        <KpiCard label="Em trial" value={kpis.trial} color="text-blue-400" />
        <KpiCard label="Inadimplentes" value={kpis.inadimplentes} color={kpis.inadimplentes > 0 ? "text-red-400" : "text-slate-300"} />
        <KpiCard label="MRR estimado" value={formatPriceBRL(kpis.mrr)} icon={<TrendingUp className="w-4 h-4" />} color="text-indigo-300" />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-[#1e2d45]">
        {([["assinaturas", "Assinaturas"], ["catalogo", "Catálogo de Planos"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === id ? "border-indigo-500 text-white" : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "assinaturas" ? (
        <>
          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nome ou segmento…"
                className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <select
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value as PlanTier | "ALL")}
              className="bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="ALL">Todos os planos</option>
              {(Object.keys(PLANS) as PlanTier[]).map((t) => (
                <option key={t} value={t}>{PLANS[t].label}</option>
              ))}
            </select>
          </div>

          {/* Tabela */}
          <div className="overflow-x-auto border border-[#1e2d45] rounded-xl">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-[#1e2d45] bg-[#0f1623]">
                  <th className="text-left py-2.5 px-4 text-xs uppercase tracking-wider text-slate-500 font-bold">Empresa</th>
                  <th className="text-left py-2.5 px-3 text-xs uppercase tracking-wider text-slate-500 font-bold">Plano</th>
                  <th className="text-left py-2.5 px-3 text-xs uppercase tracking-wider text-slate-500 font-bold">Status</th>
                  <th className="text-center py-2.5 px-3 text-xs uppercase tracking-wider text-slate-500 font-bold">Usuários</th>
                  <th className="text-center py-2.5 px-3 text-xs uppercase tracking-wider text-slate-500 font-bold">Leads</th>
                  <th className="text-left py-2.5 px-3 text-xs uppercase tracking-wider text-slate-500 font-bold">Última atividade</th>
                  <th className="text-right py-2.5 px-4 text-xs uppercase tracking-wider text-slate-500 font-bold">Ação</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-10 text-slate-500 text-sm">Nenhuma empresa encontrada.</td></tr>
                ) : filtered.map((r) => {
                  const act = relativeTime(r.lastActivity);
                  const st = r.subStatus ? STATUS_BADGE[r.subStatus] : null;
                  return (
                    <tr key={r.id} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
                      <td className="py-2.5 px-4">
                        <div className="text-white font-medium">{r.name}</div>
                        <div className="text-slate-600 text-xs">{r.segment ?? "—"}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${PLAN_BADGE[r.plan]}`}>
                          {PLANS[r.plan]?.label ?? r.plan}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        {st ? (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                        ) : (
                          <span className="text-slate-600 text-xs">sem assinatura</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center text-slate-300">{r.users}</td>
                      <td className="py-2.5 px-3 text-center text-slate-300">{r.leads}</td>
                      <td className="py-2.5 px-3">
                        <span className={act.stale ? "text-slate-500" : "text-slate-300"}>{act.label}</span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <Link
                          href={`/empresas/${r.id}`}
                          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/20 transition-colors"
                        >
                          <Settings2 className="w-3.5 h-3.5" /> Configurar
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-slate-600 text-xs mt-3">
            "Configurar" abre a empresa — use a aba <strong className="text-slate-400">💳 Plano</strong> pra trocar o plano, status e limites.
          </p>
        </>
      ) : (
        <CatalogoTab />
      )}
    </div>
  );
}

// ─── Catálogo de planos (read-only, lê de plans.ts) ──────────────────────────

function CatalogoTab() {
  const featureKeys = Object.keys(FEATURE_LABELS) as (keyof PlanFeatures)[];

  return (
    <div>
      <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4 mb-5 text-sm text-slate-400">
        Esta é a configuração de cada plano (preço, limites e recursos). A fonte é o
        catálogo do sistema — pra mudar um preço ou recurso, ajuste em{" "}
        <code className="text-indigo-300 text-xs">src/lib/plans.ts</code> ou peça pro time.
        Os planos <strong className="text-slate-300">Marketing</strong> e{" "}
        <strong className="text-slate-300">Premium</strong> existem mas estão ocultos da
        página pública por ora.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(Object.keys(PLANS) as PlanTier[])
          .filter((t) => t !== "TRIAL" && t !== "CRESCIMENTO")
          .map((tier) => {
            const p = PLANS[tier];
            const isPublic = PLAN_ORDER.includes(tier);
            const activeFeatures = featureKeys.filter((k) => p.features[k]);
            return (
              <div key={tier} className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-white font-bold text-lg">{p.label}</h3>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${PLAN_BADGE[tier]}`}>
                        {isPublic ? "Público" : tier === "ENTERPRISE" ? "Sob consulta" : "Oculto"}
                      </span>
                    </div>
                    <p className="text-slate-500 text-xs mt-0.5">{p.tagline}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-white font-bold text-xl">{formatPriceBRL(p.priceMonthly)}</div>
                    <div className="text-slate-600 text-[10px]">/mês</div>
                  </div>
                </div>

                {/* Limites */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {(Object.keys(LIMIT_LABELS) as (keyof PlanLimits)[]).map((k) => (
                    <div key={k} className="bg-[#161f30] rounded-lg px-3 py-2 flex items-center justify-between">
                      <span className="text-slate-500 text-xs">{LIMIT_LABELS[k]}</span>
                      <span className="text-slate-200 text-xs font-mono font-semibold">{limitFmt(p.limits[k])}</span>
                    </div>
                  ))}
                </div>

                {/* Features ativas */}
                <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-2">
                  Recursos incluídos ({activeFeatures.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {activeFeatures.length === 0 ? (
                    <span className="text-slate-600 text-xs">Nenhum recurso ligado.</span>
                  ) : activeFeatures.map((k) => (
                    <span key={k} className="inline-flex items-center gap-1 text-[11px] text-slate-300 bg-[#161f30] border border-[#1e2d45] rounded-full px-2 py-0.5">
                      <Check className="w-3 h-3 text-emerald-400" strokeWidth={3} />
                      {FEATURE_LABELS[k]}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

// ─── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({ label, value, icon, color }: { label: string; value: number | string; icon?: React.ReactNode; color: string }) {
  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-3.5">
      <div className="flex items-center gap-1.5 text-slate-500 text-xs mb-1">
        {icon}
        {label}
      </div>
      <div className={`font-bold text-xl ${color}`}>{value}</div>
    </div>
  );
}
