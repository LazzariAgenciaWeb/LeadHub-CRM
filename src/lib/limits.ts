/**
 * Helpers de limite e feature gating.
 *
 * Padrão "soft": quando o usuário tenta criar algo além do limite, o sistema
 * NÃO deleta nada existente — só impede criação de novo + mostra CTA "Faça
 * upgrade". Idem pra features bloqueadas (ex: "Marketing Dashboard exige
 * plano Marketing ou superior — Fazer upgrade").
 *
 * Considerações:
 *  - TRIAL conta como acesso completo (todas features) durante a janela.
 *  - Após trialEndsAt vencer sem checkout, status vira UNPAID e tudo bloqueia.
 *  - Sub-companies (parentCompanyId != null) herdam plano do pai.
 */

import { prisma } from "./prisma";
import {
  PLANS,
  type PlanTier,
  type PlanLimits,
  type PlanFeatures,
} from "./plans";

export interface CompanyPlanContext {
  companyId: string;
  effectiveCompanyId: string;   // se sub-company, é o id do pai
  tier: PlanTier;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "UNPAID" | "INCOMPLETE" | "NO_SUBSCRIPTION";
  trialEndsAt: Date | null;
  isTrialing: boolean;
  isActive: boolean;            // true se TRIALING ou ACTIVE ou (CANCELED + dentro do period_end)
  isBlocked: boolean;           // true se UNPAID, sub vencida ou trial expirado sem upgrade
  daysUntilTrialEnd: number | null;

  /** Limites efetivos = defaults do plano + overrides da Subscription. */
  effectiveLimits: PlanLimits;
  /** Features efetivas = defaults do plano + overrides da Subscription. */
  effectiveFeatures: PlanFeatures;
  /** True se houver algum override aplicado (pra UI mostrar badge "customizado"). */
  hasCustomOverrides: boolean;
}

/** Mescla overrides (parcial) sobre defaults do plano. */
function mergeLimits(base: PlanLimits, overrides: any): PlanLimits {
  if (!overrides || typeof overrides !== "object") return base;
  return {
    whatsappInstances: typeof overrides.whatsappInstances === "number" ? overrides.whatsappInstances : base.whatsappInstances,
    atendentes:        typeof overrides.atendentes === "number"        ? overrides.atendentes        : base.atendentes,
    unidades:          typeof overrides.unidades === "number"          ? overrides.unidades          : base.unidades,
    leadsPerMonth:     typeof overrides.leadsPerMonth === "number"     ? overrides.leadsPerMonth     : base.leadsPerMonth,
  };
}

function mergeFeatures(base: PlanFeatures, overrides: any): PlanFeatures {
  if (!overrides || typeof overrides !== "object") return base;
  const out: PlanFeatures = { ...base };
  for (const k of Object.keys(out) as (keyof PlanFeatures)[]) {
    if (typeof overrides[k] === "boolean") out[k] = overrides[k];
  }
  return out;
}

/**
 * Carrega contexto de plano para uma Company. Resolve herança (sub → pai),
 * aplica defaults se não houver Subscription registrada (legado).
 */
export async function getCompanyPlan(companyId: string): Promise<CompanyPlanContext> {
  // Primeiro, resolver se é sub-company (herda plano do pai)
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, parentCompanyId: true },
  });
  if (!company) throw new Error("Company não encontrada");

  const effectiveId = company.parentCompanyId ?? company.id;

  const sub = await prisma.subscription.findUnique({
    where: { companyId: effectiveId },
    select: {
      plan: true,
      status: true,
      trialEndsAt: true,
      currentPeriodEnd: true,
      customLimits: true,
      customFeatures: true,
    },
  });

  // Sem subscription registrada — trata como TRIAL legado (gracinha: libera
  // tudo até a gente migrar/preencher manualmente). Usa defaults amplos.
  if (!sub) {
    const trialPlan = PLANS.TRIAL;
    return {
      companyId,
      effectiveCompanyId: effectiveId,
      tier: "TRIAL",
      status: "NO_SUBSCRIPTION",
      trialEndsAt: null,
      isTrialing: false,
      isActive: true,
      isBlocked: false,
      daysUntilTrialEnd: null,
      effectiveLimits: trialPlan.limits,
      effectiveFeatures: trialPlan.features,
      hasCustomOverrides: false,
    };
  }

  const now = new Date();
  const isTrialing = sub.status === "TRIALING" && (!sub.trialEndsAt || sub.trialEndsAt > now);
  const isCanceledButActive = sub.status === "CANCELED" && sub.currentPeriodEnd != null && sub.currentPeriodEnd > now;
  const isActive = sub.status === "ACTIVE" || isTrialing || isCanceledButActive;
  const isBlocked = sub.status === "UNPAID" || (sub.status === "TRIALING" && sub.trialEndsAt != null && sub.trialEndsAt <= now);

  const daysUntilTrialEnd = sub.trialEndsAt
    ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
    : null;

  // Defaults do plano + overrides customizados por cliente
  const planDef = PLANS[sub.plan];
  const effectiveLimits = mergeLimits(planDef.limits, sub.customLimits);
  const effectiveFeatures = mergeFeatures(planDef.features, sub.customFeatures);
  const hasCustomOverrides =
    (sub.customLimits != null && Object.keys(sub.customLimits as any).length > 0) ||
    (sub.customFeatures != null && Object.keys(sub.customFeatures as any).length > 0);

  return {
    companyId,
    effectiveCompanyId: effectiveId,
    tier: sub.plan,
    status: sub.status,
    trialEndsAt: sub.trialEndsAt,
    isTrialing,
    isActive,
    isBlocked,
    daysUntilTrialEnd,
    effectiveLimits,
    effectiveFeatures,
    hasCustomOverrides,
  };
}

/** Verifica se a empresa tem acesso a uma feature (considerando overrides). */
export async function companyHasFeature(companyId: string, feature: keyof PlanFeatures): Promise<boolean> {
  const ctx = await getCompanyPlan(companyId);
  if (ctx.isBlocked) return false;
  return ctx.effectiveFeatures[feature] === true;
}

/** Versão síncrona — só usa defaults do plano (sem considerar overrides do cliente). */
export function tierHasFeature(tier: PlanTier, feature: keyof PlanFeatures): boolean {
  return PLANS[tier].features[feature] === true;
}

/** Retorna o limite e o uso atual de um recurso quantificável. */
export async function checkLimit(
  companyId: string,
  resource: keyof PlanLimits,
): Promise<{ allowed: boolean; used: number; limit: number; remaining: number; isUnlimited: boolean }> {
  const ctx = await getCompanyPlan(companyId);
  const limit = ctx.effectiveLimits[resource];
  const isUnlimited = limit === -1;

  let used = 0;
  if (resource === "whatsappInstances") {
    used = await prisma.whatsappInstance.count({ where: { companyId: ctx.effectiveCompanyId } });
  } else if (resource === "atendentes") {
    used = await prisma.user.count({
      where: { companyId: ctx.effectiveCompanyId, role: "CLIENT" },
    });
  } else if (resource === "unidades") {
    // Multi-unidade conta sub-companies (1 = a empresa principal)
    used = await prisma.company.count({
      where: { parentCompanyId: ctx.effectiveCompanyId },
    }) + 1;
  } else if (resource === "leadsPerMonth") {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    used = await prisma.lead.count({
      where: { companyId: ctx.effectiveCompanyId, createdAt: { gte: startOfMonth } },
    });
  }

  if (isUnlimited) {
    return { allowed: true, used, limit: -1, remaining: Infinity, isUnlimited: true };
  }

  return {
    allowed: used < limit && !ctx.isBlocked,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    isUnlimited: false,
  };
}

/**
 * Lança erro se o limite foi atingido. Use no início de POST handlers
 * que criam recursos quantificáveis.
 *
 * Exemplo:
 *   await enforceLimit(companyId, "whatsappInstances");
 *   await prisma.whatsappInstance.create({...});
 */
export class LimitExceededError extends Error {
  constructor(
    public resource: keyof PlanLimits,
    public used: number,
    public limit: number,
    public tier: PlanTier,
  ) {
    super(
      `Limite atingido: ${used}/${limit} ${resource} no plano ${PLANS[tier].label}. ` +
      `Faça upgrade ou compre add-on.`
    );
    this.name = "LimitExceededError";
  }
}

export async function enforceLimit(companyId: string, resource: keyof PlanLimits): Promise<void> {
  const r = await checkLimit(companyId, resource);
  if (r.isUnlimited) return;
  if (!r.allowed) {
    const ctx = await getCompanyPlan(companyId);
    throw new LimitExceededError(resource, r.used, r.limit, ctx.tier);
  }
}

/** Lança erro se a feature não está disponível no plano. */
export class FeatureNotAvailableError extends Error {
  constructor(public feature: keyof PlanFeatures, public tier: PlanTier) {
    super(`Feature "${feature}" não disponível no plano ${PLANS[tier].label}.`);
    this.name = "FeatureNotAvailableError";
  }
}

export async function enforceFeature(companyId: string, feature: keyof PlanFeatures): Promise<void> {
  const ctx = await getCompanyPlan(companyId);
  if (ctx.isBlocked) {
    throw new FeatureNotAvailableError(feature, ctx.tier);
  }
  if (ctx.effectiveFeatures[feature] !== true) {
    throw new FeatureNotAvailableError(feature, ctx.tier);
  }
}
