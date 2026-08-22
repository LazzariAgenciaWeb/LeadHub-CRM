/**
 * Catálogo ÚNICO de módulos — o que é vendido, e como isso vira acesso.
 *
 * Antes desta camada havia três fontes decidindo a mesma coisa: os toggles
 * `Company.module*` (Editar empresa), as features do plano (plans.ts) e os
 * `customFeatures` da assinatura. `assertModule` misturava as três com uma
 * precedência que ninguém lembrava — e pior, `moduleX = false` era ao mesmo
 * tempo o default do schema e "desliguei de propósito", então não dava pra
 * distinguir "nunca mexi" de "desativei".
 *
 * Modelo agora:
 *
 *   plano  →  define o padrão de cada módulo
 *   exceção →  liga ou desliga um módulo específico pra UMA empresa
 *   ─────────────────────────────────────────────────────────────
 *   Company.module*  =  CACHE DERIVADO, recalculado a cada save.
 *                       Ninguém edita à mão.
 *
 * Add-on NÃO entra aqui: add-on é capacidade (mais atendentes, mais números,
 * mais crédito de IA), não desbloqueio de módulo. Vive no eixo de limites.
 *
 * A exceção mora em `Subscription.customFeatures` (JSON). Chave presente =
 * exceção explícita; chave ausente = herda do plano. É tri-state de graça, sem
 * mudar o schema.
 */

import type { PlanFeatures, PlanTier } from "./plans";
import { PLANS } from "./plans";

export type ModuleGroup =
  | "Atendimento"
  | "Vendas & Produtividade"
  | "Marketing"
  | "Portal do cliente"
  | "Integrações";

/** Campos booleanos de Company que são cache derivado deste catálogo. */
export type CompanyModuleField =
  | "moduleWhatsapp" | "moduleCrm" | "moduleTickets" | "moduleAI"
  | "moduleGamificacao" | "moduleProjetos" | "moduleCalendario"
  | "moduleClickup" | "moduleEmailMarketing" | "moduleEmailInbox"
  | "moduleInstagram" | "moduleEspacoCliente" | "moduleVideos"
  | "moduleProspeccao" | "moduleBling" | "moduleRelatorioMarketing"
  | "moduleCampanhas" | "moduleLinks";

export interface AdvancedFeature {
  key: keyof PlanFeatures;
  label: string;
  description: string;
  /** Algumas features finas também têm flag própria em Company (cache). */
  companyField?: CompanyModuleField;
}

export interface ModuleDef {
  id: string;
  label: string;
  group: ModuleGroup;
  description: string;
  /** Flag em Company alimentada por este módulo (cache). */
  companyField?: CompanyModuleField;
  /**
   * Feature que representa o módulo. Ligar/desligar o módulo mexe nela.
   * Também é a que `assertModule` consulta.
   */
  primary: keyof PlanFeatures;
  /**
   * Outras features que TAMBÉM ligam o módulo (CRM: basta um pipeline).
   * Só afeta o cálculo do cache, não o controle da tela.
   */
  alsoEnabledBy?: (keyof PlanFeatures)[];
  /** Ajustes finos, escondidos atrás do "avançado" de cada módulo. */
  advanced?: AdvancedFeature[];
}

export const MODULES: ModuleDef[] = [
  // ── Atendimento ────────────────────────────────────────────────────────────
  {
    id: "whatsapp",
    label: "WhatsApp",
    group: "Atendimento",
    description: "Caixa de entrada do WhatsApp — base do produto.",
    companyField: "moduleWhatsapp",
    primary: "whatsapp",
    advanced: [
      { key: "whatsappGrupos", label: "Grupos no inbox", description: "Mostra conversas de grupo junto das individuais." },
      { key: "inboxAvancado", label: "Inbox avançado", description: "SLA, transferência, status avançado e retorno agendado." },
    ],
  },
  {
    id: "instagram",
    label: "Inbox Social",
    group: "Atendimento",
    description: "Direct do Instagram e Messenger na mesma caixa.",
    companyField: "moduleInstagram",
    primary: "socialInbox",
  },
  {
    id: "emailInbox",
    label: "Caixa de E-mail",
    group: "Atendimento",
    description: "Receber e enviar por IMAP/SMTP, com tags e triagem por IA.",
    companyField: "moduleEmailInbox",
    primary: "caixaEmail",
  },
  {
    id: "tickets",
    label: "Chamados",
    group: "Atendimento",
    description: "Tickets do cliente, com prazo e responsável.",
    companyField: "moduleTickets",
    primary: "tickets",
    advanced: [
      { key: "tarefasInternas", label: "Tarefas internas", description: "Checklist da equipe — não é chamado do cliente." },
    ],
  },

  // ── Vendas & Produtividade ─────────────────────────────────────────────────
  {
    id: "crm",
    label: "CRM",
    group: "Vendas & Produtividade",
    description: "Pipelines de leads e oportunidades.",
    companyField: "moduleCrm",
    primary: "crmPipelineLeads",
    alsoEnabledBy: ["crmPipelineOportunidades", "crmPipelineProspeccao"],
    advanced: [
      { key: "crmPipelineOportunidades", label: "Pipeline Oportunidades", description: "Qualificados em negociação." },
      { key: "crmPipelineProspeccao", label: "Pipeline Prospecção", description: "Base de busca ativa." },
    ],
  },
  {
    id: "prospeccao",
    label: "Prospecta IA",
    group: "Vendas & Produtividade",
    description: "Busca de prospects no Google Maps. Cliente traz a própria key.",
    companyField: "moduleProspeccao",
    primary: "prospectaIa",
  },
  {
    id: "projetos",
    label: "Projetos",
    group: "Vendas & Produtividade",
    description: "Gestão de projetos com status e cobrança.",
    companyField: "moduleProjetos",
    primary: "projetos",
  },
  {
    id: "calendario",
    label: "Calendário",
    group: "Vendas & Produtividade",
    description: "Agenda dia/semana/mês, com Google Calendar.",
    companyField: "moduleCalendario",
    primary: "calendario",
  },
  {
    id: "ai",
    label: "Assistente IA",
    group: "Vendas & Produtividade",
    description: "Chat e resumos com IA.",
    companyField: "moduleAI",
    primary: "assistenteIA",
  },
  {
    id: "gamificacao",
    label: "Gamificação",
    group: "Vendas & Produtividade",
    description: "Badges, ranking e prêmios da equipe.",
    companyField: "moduleGamificacao",
    primary: "gamificacao",
  },

  // ── Marketing ──────────────────────────────────────────────────────────────
  {
    id: "marketing",
    label: "Dashboard de Marketing",
    group: "Marketing",
    description: "Site, busca, origens e campanhas — orgânico e patrocinado.",
    primary: "marketingDashboard",
    advanced: [
      { key: "googleAnalytics", label: "Google Analytics 4", description: "Sessões, usuários, páginas e origens." },
      { key: "googleSearchConsole", label: "Search Console", description: "Consultas, cliques e posição na busca." },
      { key: "googleBusinessProfile", label: "Meu Negócio", description: "Avaliações e ações no Maps." },
      { key: "googleAds", label: "Google Ads", description: "Campanhas, custo e conversões." },
      { key: "metaAds", label: "Meta Ads", description: "Campanhas do Facebook e Instagram." },
    ],
  },
  {
    id: "emailMarketing",
    label: "E-mail Marketing",
    group: "Marketing",
    description: "Disparo em massa com cadência e rastreio.",
    companyField: "moduleEmailMarketing",
    primary: "emailMassa",
  },
  {
    id: "campanhas",
    label: "Campanhas & Links",
    group: "Marketing",
    description: "Campanhas com UTM e links de rastreio com pixel.",
    companyField: "moduleCampanhas",
    primary: "campanhas",
    advanced: [
      { key: "links", label: "Links de rastreio", description: "Encurtador com pixel próprio.", companyField: "moduleLinks" },
    ],
  },

  // ── Portal do cliente ──────────────────────────────────────────────────────
  {
    id: "espacoCliente",
    label: "Meu Espaço",
    group: "Portal do cliente",
    description: "Portal onde o cliente vê chamados, serviços e financeiro.",
    companyField: "moduleEspacoCliente",
    primary: "meuEspaco",
  },
  {
    id: "videos",
    label: "Biblioteca de vídeos",
    group: "Portal do cliente",
    description: "Material de apoio em vídeo para o cliente.",
    companyField: "moduleVideos",
    primary: "videos",
  },
  {
    id: "relatorioMarketing",
    label: "Relatório de Marketing (cliente)",
    group: "Portal do cliente",
    description: "O cliente abre o próprio relatório, sem os custos de mídia.",
    companyField: "moduleRelatorioMarketing",
    primary: "relatorioClienteMarketing",
  },

  // ── Integrações ────────────────────────────────────────────────────────────
  {
    id: "clickup",
    label: "ClickUp",
    group: "Integrações",
    description: "Espelha tarefas e listas com o ClickUp.",
    companyField: "moduleClickup",
    primary: "clickupSync",
  },
  {
    id: "bling",
    label: "Bling (ERP)",
    group: "Integrações",
    description: "Espelho de clientes e financeiro (boletos, NF).",
    companyField: "moduleBling",
    primary: "blingErp",
  },
  {
    id: "cofre",
    label: "Cofre de credenciais",
    group: "Integrações",
    description: "Guarda acessos do cliente com criptografia.",
    primary: "cofreCredenciais",
  },
];

export const MODULE_BY_ID = Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<string, ModuleDef>;

export const MODULE_GROUPS: ModuleGroup[] = [
  "Atendimento",
  "Vendas & Produtividade",
  "Marketing",
  "Portal do cliente",
  "Integrações",
];

// ─── Resolução ───────────────────────────────────────────────────────────────

/** De onde veio o estado atual do módulo — é isso que a tela mostra como etiqueta. */
export type ModuleOrigin = "plano" | "excecao-on" | "excecao-off";

export interface ResolvedFeature {
  key: keyof PlanFeatures;
  label: string;
  description: string;
  enabled: boolean;
  origin: ModuleOrigin;
}

export interface ResolvedModule {
  id: string;
  label: string;
  group: ModuleGroup;
  description: string;
  enabled: boolean;
  origin: ModuleOrigin;
  /** O que o plano daria, ignorando exceção — usado pra "voltar ao plano". */
  planDefault: boolean;
  advanced: ResolvedFeature[];
}

function originOf(key: keyof PlanFeatures, custom: Partial<PlanFeatures> | null, enabled: boolean): ModuleOrigin {
  if (!custom || custom[key] === undefined) return "plano";
  return enabled ? "excecao-on" : "excecao-off";
}

/**
 * Features efetivas = defaults do plano com as exceções aplicadas por cima.
 * É a única forma de calcular acesso — não existe outra fonte.
 */
export function effectiveFeatures(
  tier: PlanTier,
  custom: Partial<PlanFeatures> | null,
): PlanFeatures {
  const base = PLANS[tier]?.features ?? PLANS.FREE.features;
  return { ...base, ...(custom ?? {}) };
}

/**
 * Estado de cada módulo pra renderizar a tela: ligado?, de onde veio, e o que
 * o plano daria sem exceção.
 */
export function resolveModules(
  tier: PlanTier,
  custom: Partial<PlanFeatures> | null,
): ResolvedModule[] {
  const planFeatures = PLANS[tier]?.features ?? PLANS.FREE.features;
  const eff = effectiveFeatures(tier, custom);

  return MODULES.map((m) => {
    const keys = [m.primary, ...(m.alsoEnabledBy ?? [])];
    const enabled = keys.some((k) => eff[k]);
    const planDefault = keys.some((k) => planFeatures[k]);

    return {
      id: m.id,
      label: m.label,
      group: m.group,
      description: m.description,
      enabled,
      origin: originOf(m.primary, custom, enabled),
      planDefault,
      advanced: (m.advanced ?? []).map((a) => ({
        key: a.key,
        label: a.label,
        description: a.description,
        enabled: !!eff[a.key],
        origin: originOf(a.key, custom, !!eff[a.key]),
      })),
    };
  });
}

/**
 * Cache derivado: o shape de `Company.module*` correspondente às features
 * efetivas. Gravado a cada save da assinatura — nunca editado à mão.
 */
export function companyFlagsFromFeatures(
  features: PlanFeatures,
): Record<CompanyModuleField, boolean> {
  const out = {} as Record<CompanyModuleField, boolean>;
  for (const m of MODULES) {
    if (m.companyField) {
      const keys = [m.primary, ...(m.alsoEnabledBy ?? [])];
      out[m.companyField] = keys.some((k) => features[k]);
    }
    for (const a of m.advanced ?? []) {
      if (a.companyField) out[a.companyField] = !!features[a.key];
    }
  }
  return out;
}

/**
 * Converte o estado ATUAL de `Company.module*` em exceções explícitas, quando
 * ele diverge do que o plano daria.
 *
 * É o coração da migração: sem isso, tornar as flags derivadas apagaria todo
 * módulo que a agência tinha ligado na mão fora do plano — clientes perderiam
 * acesso no primeiro save. Roda uma vez por empresa.
 */
export function backfillExceptions(
  tier: PlanTier,
  currentFlags: Partial<Record<CompanyModuleField, boolean>>,
  custom: Partial<PlanFeatures> | null,
): Partial<PlanFeatures> {
  const planFeatures = PLANS[tier]?.features ?? PLANS.FREE.features;
  const next: Partial<PlanFeatures> = { ...(custom ?? {}) };

  for (const m of MODULES) {
    if (!m.companyField) continue;
    const current = currentFlags[m.companyField];
    if (current === undefined || current === null) continue;

    // Exceção já registrada explicitamente: respeita, não sobrescreve.
    if (next[m.primary] !== undefined) continue;

    const keys = [m.primary, ...(m.alsoEnabledBy ?? [])];
    const planGives = keys.some((k) => planFeatures[k]);
    if (current !== planGives) {
      // Divergência real → vira exceção explícita, preservando o acesso de hoje.
      (next as any)[m.primary] = current;
    }
  }
  return next;
}
