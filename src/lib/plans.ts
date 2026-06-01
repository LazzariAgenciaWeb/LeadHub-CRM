/**
 * Catálogo de planos do LeadHub.
 *
 * Fonte da verdade — qualquer mudança em preço, limite ou feature disponível
 * por plano vem daqui. UI da pricing page, helpers de limite e Stripe consomem
 * este módulo.
 *
 * Estrutura comercial (revisão 2026-05-31):
 *  - 2 planos públicos (lançamento): FREE (grátis pra sempre) e ESSENCIAL
 *  - MARKETING e PREMIUM: definidos e prontos, mas FORA da pricing page por ora
 *    (ainda atribuíveis manualmente pelo super admin). Pra publicar, basta
 *    voltar a incluí-los em PLAN_ORDER.
 *  - ENTERPRISE: sob consulta, atribuído manualmente, fora do catálogo público
 *  - CRESCIMENTO: legado (mantido no enum pra subscriptions existentes, fora
 *    da pricing page)
 *  - TRIAL: legado (enum mantido, mas FREE absorve o papel)
 *
 * Add-ons: features extras contratáveis em qualquer plano pago via
 * `Subscription.customFeatures`. Preços em `ADDON_PRICES`.
 */

export type PlanTier =
  | "FREE"
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
  // ── 🟢 Atendimento ──
  /** Acesso ao módulo WhatsApp (inbox). Base do produto. */
  whatsapp: boolean;
  /** Mostra/oculta grupos no inbox. Algumas empresas não querem grupos misturando. */
  whatsappGrupos: boolean;
  /** SLA, transferência, status avançado, retorno agendado. */
  inboxAvancado: boolean;
  /** Módulo de tickets/chamados. */
  tickets: boolean;

  // ── 🎯 Vendas & Produtividade ──
  /** Pipeline CRM "Prospecção" — base de busca ativa. */
  crmPipelineProspeccao: boolean;
  /** Pipeline CRM "Leads" — entrada padrão de novos contatos. */
  crmPipelineLeads: boolean;
  /** Pipeline CRM "Oportunidades" — qualificados em negociação. */
  crmPipelineOportunidades: boolean;
  /** Busca de prospects via Google Maps (SerpAPI). Cliente traz a própria key. */
  prospectaIa: boolean;
  /** Disparo de email em massa com cadência + tracking. */
  emailMassa: boolean;
  /** Gestão de projetos com cobrança/status. */
  projetos: boolean;
  /** Calendário (Dia/Semana/Mês + Google Calendar OAuth). */
  calendario: boolean;
  /** Gamificação (badges, ranking, prêmios). */
  gamificacao: boolean;
  /** Assistente IA (chat + resumos). */
  assistenteIA: boolean;

  // ── 📣 Marketing & Captação ──
  /** Módulo Campanhas (cria/gerencia campanhas, vincula a leads + UTMs). */
  campanhas: boolean;
  /** Módulo Links de rastreio (gera tracking links com pixel). */
  links: boolean;

  // ── 📊 Marketing & Análise ──
  marketingDashboard: boolean;
  googleAnalytics: boolean;
  googleSearchConsole: boolean;
  googleBusinessProfile: boolean;
  googleAds: boolean;
  metaAds: boolean;

  // ── 🔐 Segurança & Acesso ──
  cofreCredenciais: boolean;
  magicLink: boolean;
  bannerLgpd: boolean;
  multiUnidade: boolean;

  // ── 🔌 Integrações ──
  clickupSync: boolean;

  // ── 🏢 Enterprise ──
  apiAccess: boolean;
  whiteLabel: boolean;
  customDomain: boolean;
  suportePrioritario: boolean;
  accountManager: boolean;
}

/** Modo de atendimento default que o plano aplica ao ser atribuído. */
export type ModoAtendimentoDefault = "VISAO" | "ATENDE";

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
  /** Modo de atendimento default aplicado à empresa ao atribuir o plano. */
  modoAtendimentoDefault: ModoAtendimentoDefault;

  /** Bullets curtos pra exibir na pricing card. */
  highlights: string[];
}

// ─── Helper pra construir features com defaults ──────────────────────────────
function feat(overrides: Partial<PlanFeatures>): PlanFeatures {
  return {
    whatsapp: false,
    whatsappGrupos: false,
    inboxAvancado: false,
    tickets: false,
    crmPipelineProspeccao: false,
    crmPipelineLeads: false,
    crmPipelineOportunidades: false,
    prospectaIa: false,
    emailMassa: false,
    projetos: false,
    calendario: false,
    gamificacao: false,
    assistenteIA: false,
    campanhas: false,
    links: false,
    marketingDashboard: false,
    googleAnalytics: false,
    googleSearchConsole: false,
    googleBusinessProfile: false,
    googleAds: false,
    metaAds: false,
    cofreCredenciais: false,
    magicLink: false,
    bannerLgpd: false,
    multiUnidade: false,
    clickupSync: false,
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
  // ── FREE: trial 14 dias (porta de entrada pública) ──
  FREE: {
    tier: "FREE",
    label: "Free",
    tagline: "Grátis pra sempre",
    description: "Organize seu WhatsApp em modo Visão (somente leitura), sem risco de bloqueio — de graça, sem prazo pra acabar.",
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
      whatsapp: true,
      inboxAvancado: true,
      crmPipelineLeads: true,
      calendario: true,
    }),
    modoAtendimentoDefault: "VISAO",
    highlights: [
      "Grátis pra sempre, sem cartão",
      "1 WhatsApp · 2 atendentes",
      "Modo Visão: equipe responde pelo celular",
      "CRM Leads + Inbox + Calendário",
      "Sem prazo pra acabar",
    ],
  },

  // ── ESSENCIAL: entrada paga ──
  ESSENCIAL: {
    tier: "ESSENCIAL",
    label: "Essencial",
    tagline: "Meu WhatsApp organizado",
    description: "Atendimento ativo pelo painel + CRM com leads e oportunidades.",
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
      whatsapp: true,
      whatsappGrupos: true,
      inboxAvancado: true,
      tickets: true,
      crmPipelineLeads: true,
      links: true,
      // Ferramentas gratuitas do Google: dashboard + Analytics + Search
      // Console. GBP (depende de aprovação) e Ads (pago) ficam no
      // Marketing/Premium. Cliente conecta a própria conta Google via OAuth.
      // Calendário sai do Essencial pra abrir espaço pro Marketing entrar.
      marketingDashboard: true,
      googleAnalytics: true,
      googleSearchConsole: true,
    }),
    modoAtendimentoDefault: "ATENDE",
    highlights: [
      "1 WhatsApp · 2 atendentes",
      "Inbox completo (SLA + transferência)",
      "CRM com pipeline de Leads",
      "Tickets/Chamados",
      "Dashboard Marketing + Google Analytics + Search Console",
      "Links de rastreio",
      "Suporte por e-mail",
    ],
  },

  // ── MARKETING: meio (mais escolhido) ──
  MARKETING: {
    tier: "MARKETING",
    label: "Marketing",
    tagline: "Marketing intel sem precisar de agência",
    description: "Veja seu marketing em tempo real — para o ⭐ plano mais escolhido.",
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
      whatsapp: true,
      whatsappGrupos: true,
      inboxAvancado: true,
      tickets: true,
      crmPipelineProspeccao: true,
      crmPipelineLeads: true,
      crmPipelineOportunidades: true,
      projetos: true,
      calendario: true,
      campanhas: true,
      links: true,
      marketingDashboard: true,
      googleAnalytics: true,
      googleSearchConsole: true,
      magicLink: true,
      suportePrioritario: true,
    }),
    modoAtendimentoDefault: "ATENDE",
    highlights: [
      "2 WhatsApp · 5 atendentes",
      "CRM completo (Prospecção + Leads + Oportunidades)",
      "Campanhas + Links de rastreio",
      "Dashboard Marketing + Analytics + Search Console",
      "Projetos + Tickets",
      "Magic Link de acesso",
      "Suporte prioritário (chat)",
    ],
  },

  // ── PREMIUM: tudo + ilimitado ──
  PREMIUM: {
    tier: "PREMIUM",
    label: "Premium",
    tagline: "Operação completa, ROAS no controle",
    description: "Tudo do Marketing + Google Ads, Meta Ads, multi-unidade, API.",
    priceMonthly: 1197,
    priceAnnualPerMonth: 957,
    priceAnnualTotal: 11484,
    cta: "Assinar Premium",
    limits: {
      whatsappInstances: -1,
      atendentes: -1,
      unidades: -1,
      leadsPerMonth: -1,
    },
    features: feat({
      whatsapp: true,
      whatsappGrupos: true,
      inboxAvancado: true,
      tickets: true,
      crmPipelineProspeccao: true,
      crmPipelineLeads: true,
      crmPipelineOportunidades: true,
      projetos: true,
      calendario: true,
      campanhas: true,
      links: true,
      marketingDashboard: true,
      googleAnalytics: true,
      googleSearchConsole: true,
      googleBusinessProfile: true,
      googleAds: true,
      metaAds: true,
      magicLink: true,
      bannerLgpd: true,
      multiUnidade: true,
      apiAccess: true,
      suportePrioritario: true,
    }),
    modoAtendimentoDefault: "ATENDE",
    highlights: [
      "WhatsApp e atendentes ilimitados",
      "Multi-unidade / filiais",
      "Google Ads + Meta Ads (ROAS cruzado)",
      "Google Meu Negócio",
      "API completa",
      "Banner LGPD pronto",
      "Onboarding 1:1",
    ],
  },

  // ── ENTERPRISE: sob consulta (não público) ──
  ENTERPRISE: {
    tier: "ENTERPRISE",
    label: "Enterprise",
    tagline: "Sob consulta",
    description: "Demandas customizadas, holdings e grandes operações.",
    priceMonthly: 0,
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
      whatsapp: true,
      whatsappGrupos: true,
      inboxAvancado: true,
      tickets: true,
      crmPipelineProspeccao: true,
      crmPipelineLeads: true,
      crmPipelineOportunidades: true,
      prospectaIa: true,
      emailMassa: true,
      projetos: true,
      calendario: true,
      gamificacao: true,
      assistenteIA: true,
      campanhas: true,
      links: true,
      marketingDashboard: true,
      googleAnalytics: true,
      googleSearchConsole: true,
      googleBusinessProfile: true,
      googleAds: true,
      metaAds: true,
      cofreCredenciais: true,
      magicLink: true,
      bannerLgpd: true,
      multiUnidade: true,
      clickupSync: true,
      apiAccess: true,
      whiteLabel: true,
      customDomain: true,
      suportePrioritario: true,
      accountManager: true,
    }),
    modoAtendimentoDefault: "ATENDE",
    highlights: [
      "Tudo do Premium +",
      "Todos os add-ons inclusos",
      "SLA contratual (99.5% uptime)",
      "Account manager dedicado",
      "Integrações sob medida",
      "Treinamento da equipe",
    ],
  },

  // ── TRIAL: legado (FREE assume o papel) ──
  TRIAL: {
    tier: "TRIAL",
    label: "Trial (legado)",
    tagline: "Plano antigo — use FREE",
    description: "Mantido pra subscriptions antigas. Use o plano FREE pra trial novo.",
    priceMonthly: 0,
    priceAnnualPerMonth: 0,
    priceAnnualTotal: 0,
    cta: "—",
    limits: {
      whatsappInstances: 1,
      atendentes: 2,
      unidades: 1,
      leadsPerMonth: 200,
    },
    features: feat({
      whatsapp: true,
      inboxAvancado: true,
      crmPipelineLeads: true,
      calendario: true,
    }),
    modoAtendimentoDefault: "ATENDE",
    highlights: ["Plano legado, não público"],
  },

  // ── CRESCIMENTO: legado (absorvido por MARKETING + add-ons) ──
  CRESCIMENTO: {
    tier: "CRESCIMENTO",
    label: "Crescimento (legado)",
    tagline: "Plano antigo — use MARKETING + add-ons",
    description: "Mantido pra subscriptions antigas. Conteúdo migrou pra MARKETING com add-ons.",
    priceMonthly: 797,
    priceAnnualPerMonth: 637,
    priceAnnualTotal: 7644,
    cta: "—",
    limits: {
      whatsappInstances: 5,
      atendentes: 15,
      unidades: 5,
      leadsPerMonth: 20000,
    },
    features: feat({
      whatsapp: true,
      whatsappGrupos: true,
      inboxAvancado: true,
      tickets: true,
      crmPipelineProspeccao: true,
      crmPipelineLeads: true,
      crmPipelineOportunidades: true,
      projetos: true,
      calendario: true,
      gamificacao: true,
      assistenteIA: true,
      campanhas: true,
      links: true,
      marketingDashboard: true,
      googleAnalytics: true,
      googleSearchConsole: true,
      googleBusinessProfile: true,
      cofreCredenciais: true,
      magicLink: true,
      bannerLgpd: true,
      multiUnidade: true,
      suportePrioritario: true,
    }),
    modoAtendimentoDefault: "ATENDE",
    highlights: ["Plano legado, não público"],
  },
};

/**
 * Ordem em que os planos aparecem na pricing page (público).
 * Lançamento: só FREE e ESSENCIAL. Pra publicar MARKETING/PREMIUM, adicione-os
 * de volta aqui — as definições já estão prontas em PLANS.
 */
export const PLAN_ORDER: PlanTier[] = ["FREE", "ESSENCIAL"];

/** Planos legados/internos — não aparecem na pricing page. */
export const LEGACY_TIERS: PlanTier[] = ["TRIAL", "CRESCIMENTO"];

/** Planos não-públicos atribuídos manualmente (não aparecem na pricing page). */
export const INTERNAL_TIERS: PlanTier[] = ["ENTERPRISE"];

// ─── Add-ons (features extras contratáveis em qualquer plano pago) ───────────
// Quando ligados via Subscription.customFeatures, cobrados separados via
// Stripe (subscription item). Preço sugerido — Lazzari ajusta na UI.

export type AddonKey =
  | "prospectaIa"
  | "emailMassa"
  | "cofreCredenciais"
  | "assistenteIA"
  | "gamificacao"
  | "clickupSync"
  | "bannerLgpd"
  | "customDomain";
// Nota: white-label fora da oferta por ora (decisão 2026-05-31). A feature
// `whiteLabel` segue no PlanFeatures (flag interno do Enterprise), mas não é
// mais contratável como add-on nem aparece na UI. Pra reativar: readicionar
// "whiteLabel" aqui + o bloco em ADDONS + os labels em PricingClient/CompanySubscription.

export interface AddonDefinition {
  key: AddonKey;
  label: string;
  description: string;
  /** Preço mensal sugerido (BRL). */
  priceMonthly: number;
  /** Tier mínimo a partir do qual o add-on pode ser contratado. */
  minTier: PlanTier;
  /** Feature flag correspondente em PlanFeatures (1:1). */
  feature: keyof PlanFeatures;
}

export const ADDONS: Record<AddonKey, AddonDefinition> = {
  prospectaIa: {
    key: "prospectaIa",
    label: "LeadHub Prospecta",
    description: "Busca empresas no Google Maps e enriquece com e-mail, Instagram e Facebook. Leads entram identificados como LeadHub Prospecta.",
    priceMonthly: 49,
    minTier: "ESSENCIAL",
    feature: "prospectaIa",
  },
  emailMassa: {
    key: "emailMassa",
    label: "Email em massa",
    description: "Disparo de email com cadência + tracking + compliance LGPD.",
    priceMonthly: 99,
    minTier: "ESSENCIAL",
    feature: "emailMassa",
  },
  cofreCredenciais: {
    key: "cofreCredenciais",
    label: "Cofre de credenciais",
    description: "Senhas criptografadas com 2FA por email + auditoria.",
    priceMonthly: 49,
    minTier: "ESSENCIAL",
    feature: "cofreCredenciais",
  },
  assistenteIA: {
    key: "assistenteIA",
    label: "Assistente IA",
    description: "Chat IA + resumos automáticos de conversas.",
    priceMonthly: 79,
    minTier: "MARKETING",
    feature: "assistenteIA",
  },
  gamificacao: {
    key: "gamificacao",
    label: "Gamificação",
    description: "Badges, ranking e prêmios pra equipe.",
    priceMonthly: 49,
    minTier: "MARKETING",
    feature: "gamificacao",
  },
  clickupSync: {
    key: "clickupSync",
    label: "ClickUp Sync",
    description: "Sincronização bidirecional de tarefas com ClickUp.",
    priceMonthly: 29,
    minTier: "MARKETING",
    feature: "clickupSync",
  },
  bannerLgpd: {
    key: "bannerLgpd",
    label: "Banner LGPD pronto",
    description: "Banner de consentimento configurado pro seu site.",
    priceMonthly: 19,
    minTier: "ESSENCIAL",
    feature: "bannerLgpd",
  },
  customDomain: {
    key: "customDomain",
    label: "Domínio próprio",
    description: "Painel acessível pelo seu domínio (app.suamarca.com).",
    priceMonthly: 49,
    minTier: "MARKETING",
    feature: "customDomain",
  },
};

/** Add-ons unitários quantificáveis (cobrados por unidade extra). */
export interface UnitAddon {
  key: "whatsappExtra" | "atendenteExtra" | "unidadeExtra";
  label: string;
  description: string;
  priceMonthly: number;
  minTier: PlanTier;
  /** Recurso em PlanLimits que esse add-on incrementa. */
  resource: keyof PlanLimits;
}

export const UNIT_ADDONS: Record<UnitAddon["key"], UnitAddon> = {
  whatsappExtra: {
    key: "whatsappExtra",
    label: "Instância WhatsApp extra",
    description: "Um número adicional conectado no painel.",
    priceMonthly: 79,
    minTier: "ESSENCIAL",
    resource: "whatsappInstances",
  },
  atendenteExtra: {
    key: "atendenteExtra",
    label: "Atendente extra",
    description: "Um usuário CLIENT adicional na equipe.",
    priceMonthly: 29,
    minTier: "ESSENCIAL",
    resource: "atendentes",
  },
  unidadeExtra: {
    key: "unidadeExtra",
    label: "Unidade/filial extra",
    description: "Uma sub-empresa adicional gerenciada pelo grupo.",
    priceMonthly: 49,
    minTier: "MARKETING",
    resource: "unidades",
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

/** Lookup helper para add-ons booleanos (feature extra). */
export function getAddon(key: AddonKey): AddonDefinition {
  return ADDONS[key];
}

/**
 * Retorna se a feature está disponível como add-on contratável.
 * Útil pra UI: quando feature está OFF no plano, mostrar "ativar como add-on R$ X/mês".
 */
export function findAddonForFeature(feature: keyof PlanFeatures): AddonDefinition | null {
  for (const addon of Object.values(ADDONS)) {
    if (addon.feature === feature) return addon;
  }
  return null;
}

/**
 * Ordem de comparação entre tiers (pra checagem de `minTier` em add-ons).
 * Tiers legados/internos têm valor especial.
 */
const TIER_RANK: Record<PlanTier, number> = {
  FREE: 0,
  TRIAL: 0,
  ESSENCIAL: 1,
  MARKETING: 2,
  CRESCIMENTO: 2,
  PREMIUM: 3,
  ENTERPRISE: 4,
};

export function tierAtLeast(tier: PlanTier, minTier: PlanTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[minTier];
}
