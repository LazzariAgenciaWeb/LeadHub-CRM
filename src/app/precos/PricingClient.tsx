"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Zap, Check, Star, Sparkles, ArrowRight, X, Plus, Package,
} from "lucide-react";
import {
  formatPriceBRL,
  type PlanDefinition,
  type AddonDefinition,
  type UnitAddon,
} from "@/lib/plans";

export default function PricingClient({
  plans,
  enterprise,
  addons,
  unitAddons,
}: {
  plans: PlanDefinition[];
  enterprise: PlanDefinition;
  addons: AddonDefinition[];
  unitAddons: UnitAddon[];
}) {
  const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");

  return (
    <div className="min-h-screen bg-[#070b14] text-white">
      {/* Top bar minimalista */}
      <header className="border-b border-[#1e2d45]">
        <div className="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[9px] bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-white font-bold text-lg">LeadHub</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-slate-400 hover:text-white text-sm font-medium">
              Entrar
            </Link>
            <Link
              href="/cadastro"
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-3.5 py-1.5 rounded-lg transition-colors"
            >
              Começar grátis
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="px-5 pt-16 pb-10 text-center max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-3 py-1 text-emerald-300 text-xs font-medium mb-5">
          <Sparkles className="w-3.5 h-3.5" />
          14 dias grátis · sem cartão
        </div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4 leading-tight">
          Marketing intel <span className="bg-gradient-to-r from-indigo-400 to-pink-400 bg-clip-text text-transparent">sem precisar de agência</span>
        </h1>
        <p className="text-slate-400 text-base md:text-lg max-w-xl mx-auto leading-relaxed">
          WhatsApp + CRM + Marketing num só painel. Veja seu negócio em tempo real, não no fim do mês.
        </p>
      </section>

      {/* Toggle de ciclo */}
      <div className="flex justify-center mb-10">
        <div className="inline-flex bg-[#0d1525] border border-[#1e2d45] rounded-xl p-1">
          <button
            onClick={() => setCycle("monthly")}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              cycle === "monthly"
                ? "bg-indigo-500/20 text-indigo-300"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Mensal
          </button>
          <button
            onClick={() => setCycle("annual")}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
              cycle === "annual"
                ? "bg-indigo-500/20 text-indigo-300"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Anual
            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-bold">
              -20%
            </span>
          </button>
        </div>
      </div>

      {/* Cards de planos */}
      <section className="max-w-7xl mx-auto px-5 pb-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => (
            <PlanCard key={plan.tier} plan={plan} cycle={cycle} />
          ))}
        </div>
      </section>

      {/* Enterprise card */}
      <section className="max-w-7xl mx-auto px-5 pb-4">
        <div className="bg-gradient-to-br from-[#0d1525] to-[#1a2540] border border-[#1e2d45] rounded-2xl p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center gap-5">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center flex-shrink-0">
            <Star className="w-6 h-6 text-white" strokeWidth={2.5} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-bold text-lg">{enterprise.label}</h3>
            <p className="text-slate-400 text-sm mt-0.5">{enterprise.description}</p>
            <p className="text-slate-500 text-xs mt-2">
              {enterprise.highlights.join(" · ")}
            </p>
          </div>
          <a
            href="mailto:contato@lazzariweb.com.br?subject=LeadHub%20Enterprise"
            className="bg-white text-slate-900 hover:bg-slate-100 font-semibold text-sm px-5 py-2.5 rounded-lg transition-colors flex items-center gap-2 flex-shrink-0"
          >
            Falar com vendas
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </section>

      {/* Tabela comparativa */}
      <section className="max-w-7xl mx-auto px-5 py-12 border-t border-[#1e2d45]">
        <h2 className="text-2xl font-bold text-center mb-2">Compare os planos</h2>
        <p className="text-center text-slate-500 text-sm mb-8">
          Cada feature liberada por plano. Algumas podem ser ativadas como add-on em qualquer plano pago.
        </p>
        <ComparisonTable plans={plans} />
      </section>

      {/* Add-ons section */}
      <section className="max-w-7xl mx-auto px-5 py-12 border-t border-[#1e2d45]">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 rounded-full px-3 py-1 text-amber-300 text-xs font-medium mb-3">
            <Plus className="w-3.5 h-3.5" />
            Add-ons
          </div>
          <h2 className="text-2xl font-bold mb-2">Adicione só o que você precisa</h2>
          <p className="text-slate-400 text-sm max-w-2xl mx-auto">
            Em vez de pular pro plano de cima por causa de UMA feature, contrate ela
            como add-on no seu plano atual. Ativa quando quiser, cancela quando não usar mais.
          </p>
        </div>

        <h3 className="text-white font-semibold text-base mb-3">Features extras</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
          {addons.map((a) => (
            <AddonCard
              key={a.key}
              icon={<Package className="w-4 h-4 text-amber-400" strokeWidth={2.5} />}
              label={a.label}
              description={a.description}
              price={a.priceMonthly}
              minTier={a.minTier}
            />
          ))}
        </div>

        <h3 className="text-white font-semibold text-base mb-3">Capacidade extra (por unidade)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {unitAddons.map((a) => (
            <AddonCard
              key={a.key}
              icon={<Plus className="w-4 h-4 text-cyan-400" strokeWidth={2.5} />}
              label={a.label}
              description={a.description}
              price={a.priceMonthly}
              minTier={a.minTier}
              unit
            />
          ))}
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">
          Preços por add-on, cobrados separadamente. Cancele a qualquer momento.
        </p>
      </section>

      {/* FAQ rápido */}
      <section className="max-w-3xl mx-auto px-5 py-12 border-t border-[#1e2d45]">
        <h2 className="text-2xl font-bold text-center mb-8">Perguntas frequentes</h2>
        <div className="space-y-3">
          <Faq q="Posso testar sem cartão de crédito?">
            Sim. O trial de 14 dias libera todas as funcionalidades do plano Marketing,
            sem cartão. Você só precisa cadastrar e-mail e nome.
          </Faq>
          <Faq q="Como funciona o WhatsApp?">
            Cada plano inclui um número de instâncias (chip + WhatsApp Business). Você
            conecta via QR code no painel — leva menos de 2 minutos. Pode trocar de chip
            depois sem perder histórico.
          </Faq>
          <Faq q="O Marketing Dashboard precisa de Google Analytics?">
            Sim. Você conecta sua conta Google em 1 clique (OAuth). LeadHub puxa os
            dados todos os dias automaticamente. Sem GA4, mostramos apenas o que
            captamos via WhatsApp e webhook.
          </Faq>
          <Faq q="Como funcionam os add-ons?">
            Add-ons são features extras que você pode ativar em qualquer plano pago,
            sem precisar fazer upgrade pro plano superior. Exemplo: você está no
            Essencial e quer só Gamificação — ativa o add-on e paga R$ 49/mês a mais,
            sem trocar de plano. Pode cancelar quando quiser.
          </Faq>
          <Faq q="Posso mudar de plano depois?">
            Pode subir ou descer a qualquer momento. Diferença de valor é cobrada/creditada
            proporcional aos dias restantes do mês.
          </Faq>
          <Faq q="Como funciona o cancelamento?">
            Cancela a qualquer momento, sem multa. Continua usando até o fim do período
            já pago. Sem perguntas, sem retenção forçada.
          </Faq>
          <Faq q="Tem desconto pra ONGs / startups / educação?">
            Tem sim. Manda um e-mail pra <strong>contato@lazzariweb.com.br</strong> com seu CNPJ que avaliamos.
          </Faq>
        </div>
      </section>

      {/* CTA final */}
      <section className="max-w-3xl mx-auto px-5 py-16 text-center">
        <h2 className="text-3xl md:text-4xl font-bold mb-4">Comece grátis hoje</h2>
        <p className="text-slate-400 text-lg mb-6">
          14 dias completos com tudo liberado. Sem cartão. Cancela quando quiser.
        </p>
        <Link
          href="/cadastro"
          className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-bold px-8 py-3.5 rounded-xl text-base transition-all shadow-lg shadow-indigo-900/40"
        >
          Começar agora
          <ArrowRight className="w-5 h-5" />
        </Link>
      </section>

      <footer className="border-t border-[#1e2d45] py-8 text-center text-slate-600 text-xs">
        © 2026 Lazzari Agência Web · LeadHub é uma marca registrada
      </footer>
    </div>
  );
}

// ─── Card de plano ───────────────────────────────────────────────────────────

function PlanCard({ plan, cycle }: { plan: PlanDefinition; cycle: "monthly" | "annual" }) {
  const isPopular = plan.popular === true;
  const price = cycle === "annual" ? plan.priceAnnualPerMonth : plan.priceMonthly;
  const annualSavings = cycle === "annual" ? (plan.priceMonthly - plan.priceAnnualPerMonth) * 12 : 0;

  return (
    <div
      className={`relative bg-[#0d1525] rounded-2xl p-5 border flex flex-col ${
        isPopular
          ? "border-indigo-500 shadow-lg shadow-indigo-900/30"
          : "border-[#1e2d45]"
      }`}
    >
      {isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full">
          ⭐ Mais popular
        </div>
      )}

      <div className="mb-4">
        <h3 className={`font-bold text-lg mb-1 ${isPopular ? "text-indigo-300" : "text-white"}`}>
          {plan.label}
        </h3>
        <p className="text-slate-500 text-xs leading-snug min-h-[32px]">{plan.tagline}</p>
      </div>

      <div className="mb-5">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-white">{formatPriceBRL(price)}</span>
          <span className="text-slate-500 text-xs">/mês</span>
        </div>
        {cycle === "annual" && (
          <p className="text-emerald-400 text-[11px] mt-1 font-medium">
            Economize {formatPriceBRL(annualSavings)}/ano
          </p>
        )}
        {cycle === "monthly" && plan.priceAnnualPerMonth > 0 && (
          <p className="text-slate-600 text-[11px] mt-1">
            ou {formatPriceBRL(plan.priceAnnualPerMonth)}/mês no anual
          </p>
        )}
      </div>

      <ul className="space-y-2 mb-6 flex-1">
        {plan.highlights.map((h, i) => (
          <li key={i} className="flex items-start gap-2 text-slate-300 text-xs">
            <Check className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${isPopular ? "text-indigo-400" : "text-emerald-400"}`} strokeWidth={2.5} />
            <span>{h}</span>
          </li>
        ))}
      </ul>

      <Link
        href={`/cadastro?plano=${plan.tier.toLowerCase()}&ciclo=${cycle}`}
        className={`w-full text-center py-2.5 rounded-lg font-semibold text-sm transition-all ${
          isPopular
            ? "bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white shadow-lg shadow-indigo-900/40"
            : "bg-white/5 hover:bg-white/10 text-white border border-[#1e2d45]"
        }`}
      >
        {plan.cta || "Começar"}
      </Link>
    </div>
  );
}

// ─── Tabela comparativa ──────────────────────────────────────────────────────

function ComparisonTable({ plans }: { plans: PlanDefinition[] }) {
  type Row = { label: string; key: string; isFeature?: boolean; isLimit?: boolean; format?: (v: any) => string };
  const rows: Row[] = [
    // Limites
    { label: "WhatsApp", key: "whatsappInstances", isLimit: true, format: limitFmt },
    { label: "Atendentes", key: "atendentes", isLimit: true, format: limitFmt },
    { label: "Unidades/Filiais", key: "unidades", isLimit: true, format: limitFmt },
    { label: "Leads/mês", key: "leadsPerMonth", isLimit: true, format: limitFmt },
    // 🟢 Atendimento
    { label: "WhatsApp (Inbox)", key: "whatsapp", isFeature: true },
    { label: "Inbox avançado (SLA, transferência)", key: "inboxAvancado", isFeature: true },
    { label: "Ver grupos no inbox", key: "whatsappGrupos", isFeature: true },
    { label: "Tickets/Chamados", key: "tickets", isFeature: true },
    // 🎯 Vendas & Produtividade
    { label: "CRM — Pipeline Leads", key: "crmPipelineLeads", isFeature: true },
    { label: "CRM — Pipeline Oportunidades", key: "crmPipelineOportunidades", isFeature: true },
    { label: "CRM — Pipeline Prospecção", key: "crmPipelineProspeccao", isFeature: true },
    { label: "Prospecta IA (SerpAPI)", key: "prospectaIa", isFeature: true },
    { label: "Email em massa", key: "emailMassa", isFeature: true },
    { label: "Projetos", key: "projetos", isFeature: true },
    { label: "Calendário", key: "calendario", isFeature: true },
    { label: "Gamificação", key: "gamificacao", isFeature: true },
    { label: "Assistente IA", key: "assistenteIA", isFeature: true },
    // 📊 Marketing & Análise
    { label: "Dashboard Marketing", key: "marketingDashboard", isFeature: true },
    { label: "Google Analytics", key: "googleAnalytics", isFeature: true },
    { label: "Search Console", key: "googleSearchConsole", isFeature: true },
    { label: "Google Meu Negócio", key: "googleBusinessProfile", isFeature: true },
    { label: "Google Ads", key: "googleAds", isFeature: true },
    { label: "Meta Ads", key: "metaAds", isFeature: true },
    // 🔐 Segurança & Acesso
    { label: "Cofre de credenciais", key: "cofreCredenciais", isFeature: true },
    { label: "Magic link (login sem senha)", key: "magicLink", isFeature: true },
    { label: "Banner LGPD", key: "bannerLgpd", isFeature: true },
    { label: "Multi-unidade", key: "multiUnidade", isFeature: true },
    // 🔌 Integrações
    { label: "ClickUp Sync", key: "clickupSync", isFeature: true },
    // 🏢 Enterprise
    { label: "API completa", key: "apiAccess", isFeature: true },
    { label: "Domínio próprio", key: "customDomain", isFeature: true },
    { label: "White-label", key: "whiteLabel", isFeature: true },
    { label: "Suporte prioritário", key: "suportePrioritario", isFeature: true },
    { label: "Account manager", key: "accountManager", isFeature: true },
  ];

  function limitFmt(v: number) {
    if (v === -1) return "Ilimitado";
    return v.toLocaleString("pt-BR");
  }

  return (
    <div className="overflow-x-auto -mx-5 px-5">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-[#1e2d45]">
            <th className="text-left py-3 text-xs uppercase tracking-wider text-slate-600 font-bold">Recurso</th>
            {plans.map((p) => (
              <th key={p.tier} className={`text-center py-3 text-xs font-bold ${p.popular ? "text-indigo-300" : "text-white"}`}>
                {p.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-[#1e2d45]/50 hover:bg-white/[0.02]">
              <td className="py-2.5 text-slate-300 text-xs">{row.label}</td>
              {plans.map((p) => {
                const v = row.isLimit
                  ? (p.limits as any)[row.key]
                  : (p.features as any)[row.key];
                return (
                  <td key={p.tier} className="py-2.5 text-center">
                    {row.isFeature ? (
                      v ? (
                        <Check className="w-4 h-4 text-emerald-400 mx-auto" strokeWidth={2.5} />
                      ) : (
                        <X className="w-4 h-4 text-slate-700 mx-auto" strokeWidth={2} />
                      )
                    ) : (
                      <span className="text-slate-300 text-xs font-mono">
                        {row.format ? row.format(v) : v}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Card de add-on ──────────────────────────────────────────────────────────

function AddonCard({
  icon,
  label,
  description,
  price,
  minTier,
  unit = false,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  price: number;
  minTier: string;
  unit?: boolean;
}) {
  return (
    <div className="bg-[#0d1525] border border-[#1e2d45] rounded-xl p-4 hover:border-amber-500/40 transition-colors">
      <div className="flex items-start gap-2.5 mb-2">
        <div className="w-7 h-7 rounded-md bg-white/5 flex items-center justify-center flex-shrink-0 mt-0.5">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-white font-semibold text-sm leading-snug">{label}</h4>
          <p className="text-slate-500 text-[11px] mt-0.5 leading-snug">{description}</p>
        </div>
      </div>
      <div className="flex items-end justify-between gap-2 mt-3 pt-3 border-t border-[#1e2d45]">
        <div>
          <p className="text-white font-bold text-lg leading-none">
            {formatPriceBRL(price)}
            <span className="text-slate-500 text-[11px] font-normal ml-1">
              /mês{unit ? " · cada" : ""}
            </span>
          </p>
          <p className="text-slate-600 text-[10px] mt-1.5">
            Disponível a partir do <span className="text-slate-400 font-semibold">{minTier}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-[#0d1525] border border-[#1e2d45] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        <span className="text-white font-medium text-sm">{q}</span>
        <span className={`text-slate-500 transition-transform ${open ? "rotate-45" : ""}`}>+</span>
      </button>
      {open && (
        <div className="px-4 pb-4 text-slate-400 text-xs leading-relaxed border-t border-[#1e2d45] pt-3">
          {children}
        </div>
      )}
    </div>
  );
}
