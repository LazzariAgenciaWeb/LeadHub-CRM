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
 * Carrega contexto de plano para uma Company.
 *
 * Regras de herança (sub-empresa → pai):
 *  1. Se a sub-empresa tem Subscription PRÓPRIA → usa ela. Counts (instâncias,
 *     atendentes) são independentes do pai.
 *  2. Se a sub-empresa NÃO tem Subscription própria → herda do pai. Counts
 *     agregam com o pai (modelo agência).
 *  3. Quando a sub tem subscription própria E tem pai com subscription, as
 *     features/limites efetivos são limitados pelo PAI (teto):
 *       feature ON = ON na sub AND ON no pai
 *       limite     = min(sub, pai) — com -1 (ilimitado) tratado especialmente
 *     Isso garante que a sub-empresa nunca tenha mais que o que o pai pagou.
 *
 * Sem subscription nem na sub nem no pai → fallback TRIAL legado (libera
 * defaults amplos, comportamento histórico pra migração).
 */
export async function getCompanyPlan(companyId: string): Promise<CompanyPlanContext> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, parentCompanyId: true },
  });
  if (!company) throw new Error("Company não encontrada");

  // Tenta primeiro a Subscription PRÓPRIA da empresa
  const ownSub = await prisma.subscription.findUnique({
    where: { companyId: company.id },
    select: {
      plan: true,
      status: true,
      trialEndsAt: true,
      currentPeriodEnd: true,
      customLimits: true,
      customFeatures: true,
    },
  });

  // Carrega contexto do pai recursivamente (se houver pai). Usado como TETO
  // ou como FALLBACK dependendo se a sub tem subscription própria.
  const parentCtx = company.parentCompanyId
    ? await getCompanyPlan(company.parentCompanyId)
    : null;

  // Decide qual Subscription usar e qual companyId rastreia o uso
  let sub = ownSub;
  let effectiveCompanyId = company.id;
  if (!sub && parentCtx) {
    // Herda — sem subscription própria, usa a hierarquia do pai pra contar tudo
    effectiveCompanyId = parentCtx.effectiveCompanyId;
  }

  // Nem na sub, nem no pai → TRIAL legado
  if (!sub && !parentCtx) {
    const trialPlan = PLANS.TRIAL;
    return {
      companyId,
      effectiveCompanyId,
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

  // Sub sem subscription mas com pai → retorna o contexto do pai com o
  // effectiveCompanyId apontando pra ele (counts agregam).
  if (!sub && parentCtx) {
    return {
      ...parentCtx,
      companyId,
      effectiveCompanyId,
    };
  }

  // A partir daqui, sub é não-null (subscription própria existe)
  const subNN = sub!;
  const now = new Date();
  const isTrialing = subNN.status === "TRIALING" && (!subNN.trialEndsAt || subNN.trialEndsAt > now);
  const isCanceledButActive = subNN.status === "CANCELED" && subNN.currentPeriodEnd != null && subNN.currentPeriodEnd > now;
  const isActive = subNN.status === "ACTIVE" || isTrialing || isCanceledButActive;
  const isBlocked = subNN.status === "UNPAID" || (subNN.status === "TRIALING" && subNN.trialEndsAt != null && subNN.trialEndsAt <= now);

  const daysUntilTrialEnd = subNN.trialEndsAt
    ? Math.max(0, Math.ceil((subNN.trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
    : null;

  // Plano próprio + overrides
  const planDef = PLANS[subNN.plan];
  let effectiveLimits = mergeLimits(planDef.limits, subNN.customLimits);
  let effectiveFeatures = mergeFeatures(planDef.features, subNN.customFeatures);

  // Add-ons quantitativos: somam ao limite base (não em planos ilimitados).
  const addons = await prisma.subscriptionAddon.findMany({
    where: { companyId: effectiveCompanyId },
    select: { type: true, quantity: true },
  });
  for (const a of addons) {
    if (a.type === "EXTRA_ATENDENTE" && effectiveLimits.atendentes !== -1) {
      effectiveLimits = { ...effectiveLimits, atendentes: effectiveLimits.atendentes + a.quantity };
    } else if (a.type === "EXTRA_WHATSAPP" && effectiveLimits.whatsappInstances !== -1) {
      effectiveLimits = { ...effectiveLimits, whatsappInstances: effectiveLimits.whatsappInstances + a.quantity };
    }
  }

  // Aplica TETO do pai (se houver). Sub nunca tem mais que o pai —
  // protege a comercialização (cliente da agência não consegue overrider
  // pra cima do plano da agência).
  if (parentCtx) {
    effectiveFeatures = applyParentFeatureCeiling(effectiveFeatures, parentCtx.effectiveFeatures);
    effectiveLimits   = applyParentLimitCeiling(effectiveLimits, parentCtx.effectiveLimits);
  }

  const hasCustomOverrides =
    (subNN.customLimits != null && Object.keys(subNN.customLimits as any).length > 0) ||
    (subNN.customFeatures != null && Object.keys(subNN.customFeatures as any).length > 0);

  return {
    companyId,
    effectiveCompanyId,
    tier: subNN.plan,
    status: subNN.status,
    trialEndsAt: subNN.trialEndsAt,
    isTrialing,
    isActive,
    isBlocked,
    daysUntilTrialEnd,
    effectiveLimits,
    effectiveFeatures,
    hasCustomOverrides,
  };
}

/**
 * Aplica AND lógico entre features da sub e do pai. Feature está ON na sub
 * apenas se está ON tanto na própria sub quanto no pai (pai = teto).
 */
function applyParentFeatureCeiling(sub: PlanFeatures, parent: PlanFeatures): PlanFeatures {
  const out: PlanFeatures = { ...sub };
  for (const k of Object.keys(out) as (keyof PlanFeatures)[]) {
    out[k] = out[k] === true && parent[k] === true;
  }
  return out;
}

/**
 * Limite efetivo da sub = min(sub, pai), com -1 (ilimitado) tratado:
 *  - Pai ilimitado: respeita o limite da sub
 *  - Sub ilimitada mas pai limitado: cai pro limite do pai
 *  - Ambos limitados: min dos dois
 */
function applyParentLimitCeiling(sub: PlanLimits, parent: PlanLimits): PlanLimits {
  const out: PlanLimits = { ...sub };
  for (const k of Object.keys(out) as (keyof PlanLimits)[]) {
    const s = out[k];
    const p = parent[k];
    if (p === -1) continue;            // pai ilimitado → sub mantém o que tem
    if (s === -1) { out[k] = p; continue; } // sub ilimitada mas pai limitado → cai pro pai
    out[k] = Math.min(s, p);
  }
  return out;
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
