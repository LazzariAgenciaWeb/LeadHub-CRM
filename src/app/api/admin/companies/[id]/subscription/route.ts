import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PLANS, type PlanTier } from "@/lib/plans";
import { getCompanyPlan } from "@/lib/limits";

/**
 * Admin endpoint pra super_admin gerenciar a Subscription de uma empresa.
 *
 * GET    → retorna subscription atual + defaults do plano + overrides + uso
 * PATCH  → atualiza plan, status, customLimits, customFeatures, customNotes
 *
 * Acesso: apenas SUPER_ADMIN. Não respeita impersonation (queremos a sessão real).
 */

const ALLOWED_PLANS: PlanTier[] = ["FREE", "TRIAL", "ESSENCIAL", "MARKETING", "CRESCIMENTO", "PREMIUM", "ENTERPRISE"];

async function requireSuperAdmin() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (role !== "SUPER_ADMIN") return null;
  return session;
}

/** GET é menos restrito — ADMIN pode visualizar plano da própria empresa. */
async function requireReadAccess(companyId: string) {
  const session = await getServerSession(authOptions);
  if (!session) return null;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  if (role === "SUPER_ADMIN") return session;
  if (role === "ADMIN" && userCompanyId === companyId) return session;
  return null;
}

// GET /api/admin/companies/[id]/subscription
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params;
  const session = await requireReadAccess(companyId);
  if (!session) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const [sub, ctx, company] = await Promise.all([
    prisma.subscription.findUnique({
      where: { companyId },
      select: {
        id: true, plan: true, status: true, billingCycle: true,
        trialEndsAt: true, currentPeriodStart: true, currentPeriodEnd: true,
        cancelAtPeriodEnd: true, canceledAt: true,
        customLimits: true, customFeatures: true, customNotes: true,
        createdAt: true, updatedAt: true,
      },
    }),
    getCompanyPlan(companyId),
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        moduleWhatsapp: true, moduleCrm: true, moduleTickets: true,
        moduleAI: true, moduleClickup: true, moduleGamificacao: true,
        moduleProjetos: true, moduleCalendario: true, moduleProspeccao: true,
        modoAtendimento: true,
      },
    }),
  ]);

  return NextResponse.json({
    subscription: sub,
    planDefaults: PLANS[ctx.tier],
    effective: {
      tier: ctx.tier,
      limits: ctx.effectiveLimits,
      features: ctx.effectiveFeatures,
      hasCustomOverrides: ctx.hasCustomOverrides,
    },
    plans: PLANS,
    /** Estado atual dos Company.module* — usado pra mostrar diff ao trocar plano. */
    currentModules: company,
  });
}

// PATCH /api/admin/companies/[id]/subscription
// Body aceita qualquer subset de:
//   plan, status, billingCycle, trialEndsAt, currentPeriodEnd,
//   customLimits, customFeatures, customNotes
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Apenas super admin" }, { status: 403 });

  const { id: companyId } = await params;
  const body = await req.json();

  // Validação básica
  if (body.plan && !ALLOWED_PLANS.includes(body.plan)) {
    return NextResponse.json({ error: "plan inválido" }, { status: 400 });
  }
  if (body.status && !["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "UNPAID", "INCOMPLETE"].includes(body.status)) {
    return NextResponse.json({ error: "status inválido" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if ("plan" in body)             data.plan = body.plan;
  if ("status" in body)           data.status = body.status;
  if ("billingCycle" in body)     data.billingCycle = body.billingCycle;
  if ("trialEndsAt" in body)      data.trialEndsAt = body.trialEndsAt ? new Date(body.trialEndsAt) : null;
  if ("currentPeriodEnd" in body) data.currentPeriodEnd = body.currentPeriodEnd ? new Date(body.currentPeriodEnd) : null;
  if ("customLimits" in body)     data.customLimits = body.customLimits;       // pode ser null pra limpar
  if ("customFeatures" in body)   data.customFeatures = body.customFeatures;
  if ("customNotes" in body)      data.customNotes = body.customNotes;

  // Buscar subscription pra log de mudança de plano
  const existing = await prisma.subscription.findUnique({
    where: { companyId },
    select: { plan: true, status: true },
  });

  // Upsert — se a empresa não tem subscription ainda, cria com defaults razoáveis
  const sub = await prisma.subscription.upsert({
    where: { companyId },
    create: {
      companyId,
      plan: (body.plan as PlanTier) ?? "FREE",
      status: body.status ?? "ACTIVE",
      ...data,
    },
    update: data,
    select: {
      id: true, plan: true, status: true, customLimits: true,
      customFeatures: true, customNotes: true, trialEndsAt: true,
    },
  });

  // Log de mudança de plano
  const planChanged = !!(body.plan && (!existing || existing.plan !== body.plan));

  if (existing && body.plan && existing.plan !== body.plan) {
    await prisma.billingEvent.create({
      data: {
        companyId,
        type: "plan_changed_admin",
        fromPlan: existing.plan,
        toPlan: body.plan,
        metadata: { changedBy: (session.user as any).id ?? null, manual: true },
      },
    });
  }

  // Sync com Company.module*: SEMPRE roda após salvar, pra garantir que
  // os módulos efetivos da empresa refletem o plano + customFeatures.
  // Antes só rodava quando plano mudava — bug: ativar feature via override
  // não propagava pro Sidebar/gates. Agora qualquer save recalcula.
  //
  // Estratégia: usa getCompanyPlan() pra pegar features EFETIVAS (plan
  // defaults + customFeatures merged), e converte pra Company.module*.
  // Modo de atendimento só muda quando o plano muda (preserva escolha
  // manual no resto dos cenários).
  const ctx = await getCompanyPlan(companyId);
  const modoAtendimentoToApply = planChanged
    ? PLANS[ctx.tier].modoAtendimentoDefault
    : undefined;

  const modulesUpdate: Record<string, unknown> = {
    moduleWhatsapp:    ctx.effectiveFeatures.whatsapp,
    moduleCrm:         ctx.effectiveFeatures.crmPipelineLeads
                       || ctx.effectiveFeatures.crmPipelineOportunidades
                       || ctx.effectiveFeatures.crmPipelineProspeccao,
    moduleTickets:     ctx.effectiveFeatures.tickets,
    moduleAI:          ctx.effectiveFeatures.assistenteIA,
    moduleClickup:     ctx.effectiveFeatures.clickupSync,
    moduleGamificacao: ctx.effectiveFeatures.gamificacao,
    moduleProjetos:    ctx.effectiveFeatures.projetos,
    moduleCalendario:  ctx.effectiveFeatures.calendario,
    moduleProspeccao:  ctx.effectiveFeatures.prospectaIa,
  };
  if (modoAtendimentoToApply !== undefined) {
    modulesUpdate.modoAtendimento = modoAtendimentoToApply;
  }

  await prisma.company.update({
    where: { id: companyId },
    data: modulesUpdate,
  });

  return NextResponse.json({ subscription: sub, appliedSync: modulesUpdate });
}
