"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Zap, Check, Star, MessageSquare, BarChart3, Globe,
  ShieldCheck, Sparkles, ArrowRight, X,
} from "lucide-react";
import { formatPriceBRL, type PlanDefinition } from "@/lib/plans";

export default function PricingClient({
  plans,
  enterprise,
  free,
}: {
  plans: PlanDefinition[];
  enterprise: PlanDefinition;
  free?: PlanDefinition;
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

      {/* Free / Sob convite */}
      {free && (
        <section className="max-w-7xl mx-auto px-5 pb-12">
          <div className="bg-[#0a1220] border border-emerald-500/20 rounded-2xl p-5 md:p-6 flex flex-col md:flex-row items-start md:items-center gap-5">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-emerald-400" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-white font-bold text-base">{free.label}</h3>
                <span className="text-[10px] text-emerald-300 bg-emerald-500/15 px-1.5 py-0.5 rounded uppercase font-bold">
                  Sob convite
                </span>
              </div>
              <p className="text-slate-400 text-xs mt-1">{free.description}</p>
            </div>
            <a
              href="mailto:contato@lazzariweb.com.br?subject=LeadHub%20Free%20-%20convite"
              className="bg-white/5 hover:bg-white/10 text-emerald-300 border border-emerald-500/30 font-semibold text-xs px-4 py-2 rounded-lg transition-colors flex-shrink-0"
            >
              Solicitar convite
            </a>
          </div>
        </section>
      )}

      {/* Tabela comparativa */}
      <section className="max-w-7xl mx-auto px-5 py-12 border-t border-[#1e2d45]">
        <h2 className="text-2xl font-bold text-center mb-8">Compare os planos</h2>
        <ComparisonTable plans={plans} />
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
    // Inbox / CRM
    { label: "Inbox WhatsApp avançado", key: "inboxAvancado", isFeature: true },
    { label: "CRM básico", key: "crmBasico", isFeature: true },
    { label: "Pipeline customizável", key: "crmAvancado", isFeature: true },
    { label: "Tickets/Chamados", key: "tickets", isFeature: true },
    // Marketing
    { label: "Dashboard Marketing", key: "marketingDashboard", isFeature: true },
    { label: "Google Analytics", key: "googleAnalytics", isFeature: true },
    { label: "Search Console", key: "googleSearchConsole", isFeature: true },
    { label: "Google Meu Negócio", key: "googleBusinessProfile", isFeature: true },
    { label: "Google Ads", key: "googleAds", isFeature: true },
    { label: "Meta Ads", key: "metaAds", isFeature: true },
    // Operacional
    { label: "Cofre de credenciais", key: "cofreCredenciais", isFeature: true },
    { label: "Magic link (login sem senha)", key: "magicLink", isFeature: true },
    { label: "Assistente IA", key: "assistenteIA", isFeature: true },
    { label: "Multi-unidade", key: "multiUnidade", isFeature: true },
    { label: "Banner LGPD", key: "bannerLgpd", isFeature: true },
    // Avançado
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
