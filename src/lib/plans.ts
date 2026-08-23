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
  | "ORGANIZATION"
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
  // ── 🏠 Espaço do cliente ──
  /** Home simplificada do cliente: acessos rápidos, chamados, serviços contratados. */
  meuEspaco: boolean;

  // ── 🟢 Atendimento ──
  /** Acesso ao módulo WhatsApp (inbox). Base do produto. */
  whatsapp: boolean;
  /** Mostra/oculta grupos no inbox. Algumas empresas não querem grupos misturando. */
  whatsappGrupos: boolean;
  /** SLA, transferência, status avançado, retorno agendado. */
  inboxAvancado: boolean;
  /** Caixa de entrada unificada de Instagram + Facebook (DMs viram conversa). */
  socialInbox: boolean;
  /** Módulo de tickets/chamados. */
  tickets: boolean;
  /** Tarefas internas da equipe (checklist operacional, não é chamado do cliente). */
  tarefasInternas: boolean;

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
  /** Caixa de E-mail (Atender): receber/enviar via IMAP+SMTP, tags, triagem IA. */
  caixaEmail: boolean;
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
  /** Biblioteca de vídeos estilo Netflix (material de apoio do cliente). */
  videos: boolean;

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
  /** Bling (ERP): espelho de clientes + boletos/NF no financeiro. */
  blingErp: boolean;
  /** Relatório de Marketing dentro do portal do cliente (sem custos de mídia). */
  relatorioClienteMarketing: boolean;

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
    meuEspaco: false,
    whatsapp: false,
    whatsappGrupos: false,
    inboxAvancado: false,
    socialInbox: false,
    tickets: false,
    tarefasInternas: false,
    crmPipelineProspeccao: false,
    crmPipelineLeads: false,
    crmPipelineOportunidades: false,
    prospectaIa: false,
    emailMassa: false,
    caixaEmail: false,
    projetos: false,
    calendario: false,
    gamificacao: false,
    assistenteIA: false,
    campanhas: false,
    links: false,
    videos: false,
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
    blingErp: false,
    relatorioClienteMarketing: false,
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
  // ── FREE: porta de entrada (observabilidade + material) ──
  // Sem WhatsApp. Cliente entra pra ver o Espaço dele + relatórios de
  // marketing (ferramentas Google gratuitas) + vídeos de apoio.
  FREE: {
    tier: "FREE",
    label: "Free",
    tagline: "Seu espaço + relatórios de marketing",
    description: "Meu Espaço, Dashboard de Marketing (Google Analytics + Search Console) e biblioteca de vídeos — grátis pra sempre, sem cartão.",
    priceMonthly: 0,
    priceAnnualPerMonth: 0,
    priceAnnualTotal: 0,
    cta: "Começar grátis",
    limits: {
      whatsappInstances: 0,
      atendentes: 1,
      unidades: 1,
      leadsPerMonth: 100,
    },
    features: feat({
      // Isca: mostra o produto sem entregar o diferencial.
      // O Dashboard de Marketing saiu daqui de propósito — é o motivo de subir.
      meuEspaco: true,
      videos: true,
}),
    modoAtendimentoDefault: "VISAO",
    highlights: [
      "Grátis pra sempre, sem cartão",
      "Meu Espaço (acessos + serviços)",
      "Dashboard Marketing (Analytics + Search Console)",
      "Biblioteca de vídeos",
    ],
  },

  // ── ORGANIZATION: Free + agenda, cofre e Meu Negócio ──
  ORGANIZATION: {
    tier: "ORGANIZATION",
    label: "Organization",
    tagline: "Organize acessos, agenda e reputação",
    description: "Tudo do Free + Calendário, Cofre de senhas e Google Meu Negócio (avaliações e insights).",
    priceMonthly: 49.90,
    priceAnnualPerMonth: 39.90,
    priceAnnualTotal: 478.80,
    cta: "Assinar Organization",
    limits: {
      whatsappInstances: 0,
      atendentes: 2,
      unidades: 1,
      leadsPerMonth: 300,
    },
    features: feat({
      // herda Free
      meuEspaco: true,
      marketingDashboard: true,
      googleAnalytics: true,
      googleSearchConsole: true,
      videos: true,
      // + diferenciais
      calendario: true,
      cofreCredenciais: true,
      googleBusinessProfile: true,
    }),
    modoAtendimentoDefault: "VISAO",
    highlights: [
      "Tudo do Free +",
      "Calendário",
      "Cofre de credenciais (senhas + 2FA)",
      "Google Meu Negócio (avaliações + insights)",
    ],
  },

  // ── ESSENCIAL: Organization + WhatsApp em leitura + CRM Leads ──
  ESSENCIAL: {
    tier: "ESSENCIAL",
    label: "Essencial",
    tagline: "Acompanhe seu WhatsApp e seus leads",
    description: "Tudo do Organization + WhatsApp em modo leitura (Visão) e CRM com pipeline de Leads.",
    priceMonthly: 97,
    priceAnnualPerMonth: 77,
    priceAnnualTotal: 924,
    cta: "Assinar Essencial",
    limits: {
      whatsappInstances: 1,
      atendentes: 2,
      unidades: 1,
      leadsPerMonth: 1000,
    },
    features: feat({
      meuEspaco: true,
      videos: true,
      calendario: true,
      cofreCredenciais: true,
      // Atender
      whatsapp: true,
      whatsappGrupos: true,
      inboxAvancado: true,
      tickets: true,
      tarefasInternas: true,
      // Vender
      crmPipelineLeads: true,
      crmPipelineOportunidades: true,
}),
    modoAtendimentoDefault: "VISAO",
    highlights: [
      "Tudo do Organization +",
      "WhatsApp em modo leitura (equipe responde pelo celular)",
      "CRM com pipeline de Leads",
      "1 WhatsApp · 2 atendentes",
    ],
  },

  // ── MARKETING: Essencial + operação de captação ──
  MARKETING: {
    tier: "MARKETING",
    label: "Marketing",
    tagline: "Opere seu marketing e feche negócios",
    description: "Tudo do Essencial + CRM completo, gestão de clientes, links rastreáveis, campanhas e Caixa de Entrada do WhatsApp.",
    priceMonthly: 397,
    priceAnnualPerMonth: 317,
    priceAnnualTotal: 3804,
    popular: true,
    cta: "Assinar Marketing",
    limits: {
      whatsappInstances: 1,
      atendentes: 5,
      unidades: 1,
      leadsPerMonth: 5000,
    },
    features: feat({
      // herda Essencial
      meuEspaco: true,
      videos: true,
      calendario: true,
      cofreCredenciais: true,
      whatsapp: true,
      whatsappGrupos: true,
      inboxAvancado: true,
      tickets: true,
      tarefasInternas: true,
      crmPipelineLeads: true,
      crmPipelineOportunidades: true,
      // + o diferencial: marketing de ponta a ponta
      marketingDashboard: true,
      googleAnalytics: true,
      googleSearchConsole: true,
      googleBusinessProfile: true,
      googleAds: true,
      metaAds: true,
      relatorioClienteMarketing: true,
      campanhas: true,
      links: true,
      emailMassa: true,
      // + canais e IA
      socialInbox: true,
      assistenteIA: true,
      crmPipelineProspeccao: true,
      multiUnidade: true,
      magicLink: true,
      suportePrioritario: true,
}),
    modoAtendimentoDefault: "ATENDE",   // Caixa de Entrada completa
    highlights: [
      "Tudo do Essencial +",
      "WhatsApp com Caixa de Entrada (responde pelo painel)",
      "CRM completo (Prospecção + Leads + Oportunidades)",
      "Empresas (gerencie seus clientes)",
      "Campanhas + Links rastreáveis",
      "1 WhatsApp · 5 atendentes",
      "Suporte prioritário",
    ],
  },

  // ── PREMIUM: operação completa + equipe ──
  PREMIUM: {
    tier: "PREMIUM",
    label: "Premium",
    tagline: "Operação completa com equipe",
    description: "Tudo do Marketing + E-mail marketing, Instagram/Facebook na inbox, Projetos, Chamados, Tarefas internas e Gamificação.",
    priceMonthly: 997,
    priceAnnualPerMonth: 797,
    priceAnnualTotal: 9564,
    cta: "Assinar Premium",
    limits: {
      whatsappInstances: 2,
      atendentes: 10,
      unidades: -1,
      leadsPerMonth: -1,
    },
    features: feat({
      // herda Marketing
      meuEspaco: true,
      videos: true,
      calendario: true,
      cofreCredenciais: true,
      whatsapp: true,
      whatsappGrupos: true,
      inboxAvancado: true,
      tickets: true,
      tarefasInternas: true,
      crmPipelineLeads: true,
      crmPipelineOportunidades: true,
      crmPipelineProspeccao: true,
      marketingDashboard: true,
      googleAnalytics: true,
      googleSearchConsole: true,
      googleBusinessProfile: true,
      googleAds: true,
      metaAds: true,
      relatorioClienteMarketing: true,
      campanhas: true,
      links: true,
      emailMassa: true,
      socialInbox: true,
      assistenteIA: true,
      multiUnidade: true,
      magicLink: true,
      suportePrioritario: true,
      // + operação pesada
      caixaEmail: true,
      projetos: true,
      gamificacao: true,
      clickupSync: true,
      prospectaIa: true,
      blingErp: true,
      bannerLgpd: true,
}),
    modoAtendimentoDefault: "ATENDE",
    highlights: [
      "Tudo do Marketing +",
      "E-mail marketing",
      "Instagram + Facebook na Caixa de Entrada",
      "Projetos + Chamados + Tarefas internas",
      "Gamificação da equipe",
      "2 WhatsApp · 10 usuários",
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
      meuEspaco: true,
      whatsapp: true,
      whatsappGrupos: true,
      inboxAvancado: true,
      socialInbox: true,
      tickets: true,
      tarefasInternas: true,
      crmPipelineProspeccao: true,
      crmPipelineLeads: true,
      crmPipelineOportunidades: true,
      prospectaIa: true,
      emailMassa: true,
      caixaEmail: true,
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
// Vitrine: 3 pagos + Free. ORGANIZATION foi aposentado — competia de frente
// com o Essencial (R$49,90 × R$97) e confundia a escolha. Quem já assina segue
// nele via LEGACY_TIERS, sem perder nada.
export const PLAN_ORDER: PlanTier[] = ["FREE", "ESSENCIAL", "MARKETING", "PREMIUM"];

/** Planos legados/internos — não aparecem na pricing page. */
export const LEGACY_TIERS: PlanTier[] = ["TRIAL", "CRESCIMENTO", "ORGANIZATION"];

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
    label: "Número WhatsApp extra",
    description: "Um número adicional conectado no painel.",
    priceMonthly: 99,
    minTier: "ESSENCIAL",
    resource: "whatsappInstances",
  },
  atendenteExtra: {
    key: "atendenteExtra",
    label: "Atendente extra",
    description: "Um usuário adicional na equipe.",
    priceMonthly: 19.90,
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
  ORGANIZATION: 1,   // acima do FREE, abaixo do ESSENCIAL
  ESSENCIAL: 2,
  MARKETING: 3,
  CRESCIMENTO: 3,
  PREMIUM: 4,
  ENTERPRISE: 5,
};

export function tierAtLeast(tier: PlanTier, minTier: PlanTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[minTier];
}
