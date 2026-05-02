/**
 * Catálogo de planos do LeadHub.
 *
 * Fonte da verdade — qualquer mudança em preço, limite ou feature disponível
 * por plano vem daqui. UI da pricing page, helpers de limite e Stripe consomem
 * este módulo.
 *
 * Estratégia comercial: vender pra cliente final (não agência). Cobra por
 * WhatsApp instances + atendentes + features (marketing, GBP, IA, etc.).
 */

export type PlanTier =
  | "TRIAL"
  | "ESSENCIAL"
  | "MARKETING"
  | "CRESCIMENTO"
  | "PREMIUM"
  | "ENTERPRISE";

/** Limites numéricos. -1 significa "ilimitado". */
export interface PlanLimits {
  whatsappInstances: number;
  atendentes: number;            // usuários CLIENT na empresa (não conta admin)
  unidades: number;              // multi-unidade / filiais
  leadsPerMonth: number;         // limite soft de leads recebidos via webhook
}

export interface PlanFeatures {
  // Inbox & CRM
  crmBasico: boolean;
  crmAvancado: boolean;          // pipeline custom multi
  inboxAvancado: boolean;        // SLA, transfer, status, scheduled
  // Marketing
  marketingDashboard: boolean;
  googleAnalytics: boolean;
  googleSearchConsole: boolean;
  googleBusinessProfile: boolean;
  googleAds: boolean;
  metaAds: boolean;
  // Operacional
  cofreCredenciais: boolean;
  magicLink: boolean;
  tickets: boolean;
  assistenteIA: boolean;
  multiUnidade: boolean;
  bannerLgpd: boolean;
  // Avançado
  apiAccess: boolean;
  whiteLabel: boolean;
  customDomain: boolean;
  suportePrioritario: boolean;
  accountManager: boolean;
}

export interface PlanDefinition {
  tier: PlanTier;
  label: string;
  tagline: string;
  description: string;

  /** Preço mensal em reais (BRL) — pago mês a mês. */
  priceMonthly: number;
  /** Preço cobrado por mês quando o cliente paga ANUAL (com desconto). */
  priceAnnualPerMonth: number;
  /** Total cobrado quando paga anual. */
  priceAnnualTotal: number;

  /** Stripe Price IDs — preencha após criar no painel Stripe. */
  stripePriceIdMonthly?: string;
  stripePriceIdAnnual?: string;

  popular?: boolean;
  cta?: string;

  limits: PlanLimits;
  features: PlanFeatures;

  /** Bullets curtos pra exibir na pricing card. */
  highlights: string[];
}

// ─── Helper pra construir features com defaults ──────────────────────────────
function feat(overrides: Partial<PlanFeatures>): PlanFeatures {
  return {
    crmBasico: false,
    crmAvancado: false,
    inboxAvancado: false,
    marketingDashboard: false,
    googleAnalytics: false,
    googleSearchConsole: false,
    googleBusinessProfile: false,
    googleAds: false,
    metaAds: false,
    cofreCredenciais: false,
    magicLink: false,
    tickets: false,
    assistenteIA: false,
    multiUnidade: false,
    bannerLgpd: false,
    apiAccess: false,
    whiteLabel: false,
    customDomain: false,
    suportePrioritario: false,
    accountManager: false,
    ...overrides,
  };
}

// ─── Catálogo de planos ──────────────────────────────────────────────────────

export const PLANS: Record<PlanTier, PlanDefinition> = {
  TRIAL: {
    tier: "TRIAL",
    label: "Trial",
    tagline: "14 dias grátis",
    description: "Teste tudo sem cartão",
    priceMonthly: 0,
    priceAnnualPerMonth: 0,
    priceAnnualTotal: 0,
    cta: "Começar grátis",
    limits: {
      whatsappInstances: 1,
      atendentes: 2,
      unidades: 1,
      leadsPerMonth: 200,
    },
    features: feat({
      crmBasico: true,
      crmAvancado: true,
      inboxAvancado: true,
      marketingDashboard: true,
      googleAnalytics: true,
      googleSearchConsole: true,
      cofreCredenciais: true,
      magicLink: true,
      tickets: true,
      bannerLgpd: true,
    }),
    highlights: [
      "14 dias completos sem cartão",
      "Acesso a todas features Marketing",
      "1 WhatsApp · 2 atendentes",
      "Suporte por chat",
    ],
  },

  ESSENCIAL: {
    tier: "ESSENCIAL",
    label: "Essencial",
    tagline: "Meu WhatsApp organizado",
    description: "Pra quem está começando — inbox + CRM básico",
    priceMonthly: 147,
    priceAnnualPerMonth: 117,
    priceAnnualTotal: 1404,
    cta: "Assinar Essencial",
    limits: {
      whatsappInstances: 1,
      atendentes: 2,
      unidades: 1,
      leadsPerMonth: 1000,
    },
    features: feat({
      crmBasico: true,
      inboxAvancado: true,
    }),
    highlights: [
      "1 WhatsApp · 2 atendentes",
      "Inbox completo (SLA, transferência)",
      "CRM básico",
      "Webhook de leads",
      "Calendário",
      "Suporte por e-mail",
    ],
  },

  MARKETING: {
    tier: "MARKETING",
    label: "Marketing",
    tagline: "Marketing intel sem precisar de agência",
    description: "Veja seu marketing em tempo real — para o ⭐ plano mais escolhido",
    priceMonthly: 397,
    priceAnnualPerMonth: 317,
    priceAnnualTotal: 3804,
    popular: true,
    cta: "Assinar Marketing",
    limits: {
      whatsappInstances: 2,
      atendentes: 5,
      unidades: 1,
      leadsPerMonth: 5000,
    },
    features: feat({
      crmBasico: true,
      crmAvancado: true,
      inboxAvancado: true,
      marketingDashboard: true,
      googleAnalytics: true,
      googleSearchConsole: true,
      cofreCredenciais: true,
      magicLink: true,
      tickets: true,
    }),
    highlights: [
      "2 WhatsApp · 5 atendentes",
      "Dashboard Marketing completo",
      "Mapa interativo + origens com IA",
      "Google Analytics + Search Console",
      "Cofre de credenciais (com 2FA)",
      "Tickets/Chamados",
      "Suporte por chat",
    ],
  },

  CRESCIMENTO: {
    tier: "CRESCIMENTO",
    label: "Crescimento",
    tagline: "Negócio em expansão, múltiplos canais",
    description: "Pra empresa em escala, com várias unidades",
    priceMonthly: 797,
    priceAnnualPerMonth: 637,
    priceAnnualTotal: 7644,
    cta: "Assinar Crescimento",
    limits: {
      whatsappInstances: 5,
      atendentes: 15,
      unidades: 5,
      leadsPerMonth: 20000,
    },
    features: feat({
      crmBasico: true,
      crmAvancado: true,
      inboxAvancado: true,
      marketingDashboard: true,
      googleAnalytics: true,
      googleSearchConsole: true,
      googleBusinessProfile: true,
      cofreCredenciais: true,
      magicLink: true,
      tickets: true,
      assistenteIA: true,
      multiUnidade: true,
      bannerLgpd: true,
      suportePrioritario: true,
    }),
    highlights: [
      "5 WhatsApp · 15 atendentes",
      "Multi-unidade / filiais",
      "Google Meu Negócio",
      "Assistente IA integrado",
      "Banner LGPD pronto",
      "Backup automático",
      "Suporte prioritário",
    ],
  },

  PREMIUM: {
    tier: "PREMIUM",
    label: "Premium",
    tagline: "Performance avançada, ROAS no controle",
    description: "Pra empresas com investimento alto em ads",
    priceMonthly: 1997,
    priceAnnualPerMonth: 1597,
    priceAnnualTotal: 19164,
    cta: "Assinar Premium",
    limits: {
      whatsappInstances: -1,
      atendentes: -1,
      unidades: -1,
      leadsPerMonth: -1,
    },
    features: feat({
      crmBasico: true,
      crmAvancado: true,
      inboxAvancado: true,
      marketingDashboard: true,
      googleAnalytics: true,
      googleSearchConsole: true,
      googleBusinessProfile: true,
      googleAds: true,
      metaAds: true,
      cofreCredenciais: true,
      magicLink: true,
      tickets: true,
      assistenteIA: true,
      multiUnidade: true,
      bannerLgpd: true,
      apiAccess: true,
      customDomain: true,
      suportePrioritario: true,
    }),
    highlights: [
      "WhatsApp e atendentes ilimitados",
      "Google Ads + Meta Ads",
      "ROAS cruzado (anúncio → lead → venda)",
      "Domínio próprio (white-label)",
      "API completa",
      "Onboarding 1:1 (4h)",
    ],
  },

  ENTERPRISE: {
    tier: "ENTERPRISE",
    label: "Enterprise",
    tagline: "Sob consulta",
    description: "Demandas customizadas, holdings e grandes operações",
    priceMonthly: 0,    // sob consulta
    priceAnnualPerMonth: 0,
    priceAnnualTotal: 0,
    cta: "Falar com vendas",
    limits: {
      whatsappInstances: -1,
      atendentes: -1,
      unidades: -1,
      leadsPerMonth: -1,
    },
    features: feat({
      crmBasico: true,
      crmAvancado: true,
      inboxAvancado: true,
      marketingDashboard: true,
      googleAnalytics: true,
      googleSearchConsole: true,
      googleBusinessProfile: true,
      googleAds: true,
      metaAds: true,
      cofreCredenciais: true,
      magicLink: true,
      tickets: true,
      assistenteIA: true,
      multiUnidade: true,
      bannerLgpd: true,
      apiAccess: true,
      whiteLabel: true,
      customDomain: true,
      suportePrioritario: true,
      accountManager: true,
    }),
    highlights: [
      "Tudo do Premium +",
      "White-label completo",
      "SLA contratual (99.5% uptime)",
      "Account manager dedicado",
      "Integrações sob medida",
      "Treinamento da equipe",
    ],
  },
};

/** Ordem em que os planos aparecem na pricing page. */
export const PLAN_ORDER: PlanTier[] = ["ESSENCIAL", "MARKETING", "CRESCIMENTO", "PREMIUM"];

/** Pretty number → "R$ 397". */
export function formatPriceBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 }).format(value);
}

/** Lookup helper. */
export function getPlan(tier: PlanTier): PlanDefinition {
  return PLANS[tier];
}

/** Verifica se um plano (tier) tem uma feature específica habilitada. */
export function planHasFeature(tier: PlanTier, feature: keyof PlanFeatures): boolean {
  return PLANS[tier].features[feature] === true;
}

/** Retorna o limite numérico (-1 = ilimitado) de um recurso pra um plano. */
export function getPlanLimit(tier: PlanTier, resource: keyof PlanLimits): number {
  return PLANS[tier].limits[resource];
}
