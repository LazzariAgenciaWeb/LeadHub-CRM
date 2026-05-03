/**
 * billing.ts
 *
 * Gate de módulo/feature server-side. Antes do fix A3 a Sidebar escondia
 * itens de plano superior (`hasModule(session, 'gamificacao')`), mas as rotas
 * `/api/gamificacao/*`, `/api/integrations/*`, `/api/premios/*`, etc. não
 * checavam — cliente em FREE acessava direto via URL.
 *
 * Uso típico em rota:
 *
 *   import { assertModule } from "@/lib/billing";
 *
 *   export async function GET(req) {
 *     const session = await getServerSession(authOptions);
 *     if (!session) return NextResponse.json({error:"401"},{status:401});
 *     const gate = await assertModule(session, "gamificacao");
 *     if (!gate.ok) return gate.response;
 *     // ... resto da rota
 *   }
 */

import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import {
  PLANS,
  type PlanFeatures,
  type PlanTier,
} from "./plans";

// Módulos visíveis na Sidebar — chaves usadas pelo `Company.module*`.
export type ModuleName =
  | "whatsapp"
  | "crm"
  | "tickets"
  | "ai"
  | "gamificacao"
  | "marketing"
  | "cofre"
  | "calendario"
  | "projetos";

export type ModuleGateResult =
  | { ok: true }
  | { ok: false; reason: string; response: NextResponse };

const FEATURE_BY_MODULE: Record<ModuleName, keyof PlanFeatures | null> = {
  whatsapp:    null,                // controlado por moduleWhatsapp + plano (Inbox base sempre)
  crm:         "crmBasico",
  tickets:     "tickets",
  ai:          "assistenteIA",
  gamificacao: null,                // por enquanto livre quando empresa habilitou
  marketing:   "marketingDashboard",
  cofre:       "cofreCredenciais",
  calendario:  "calendario",
  projetos:    "projetos",
};

function denied(reason: string): ModuleGateResult {
  return {
    ok: false,
    reason,
    response: NextResponse.json(
      { error: "Módulo não disponível no seu plano", reason },
      { status: 403 },
    ),
  };
}

/**
 * Valida se a Company da sessão tem acesso ao módulo. Combina:
 *   - Flag explícita em Company.module* (ON/OFF por cliente)
 *   - Feature do plano da Subscription (com `customFeatures` override)
 *
 * SUPER_ADMIN sempre passa. ADMIN/CLIENT respeitam a configuração da empresa.
 */
export async function assertModule(
  session: any,
  module: ModuleName,
): Promise<ModuleGateResult> {
  const role = session?.user?.role as string | undefined;
  if (role === "SUPER_ADMIN") return { ok: true };

  const companyId = session?.user?.companyId as string | undefined;
  if (!companyId) return denied("sem companyId na sessão");

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      moduleWhatsapp: true,
      moduleCrm: true,
      moduleTickets: true,
      moduleAI: true,
      moduleGamificacao: true,
      moduleProjetos: true,
      moduleCalendario: true,
      subscription: {
        select: {
          plan: true,
          status: true,
          customFeatures: true,
        },
      },
    },
  });
  if (!company) return denied("empresa não encontrada");

  // 1) Flag explícita do módulo na empresa (toggle do super admin)
  const flagMap: Record<ModuleName, boolean | null> = {
    whatsapp:    company.moduleWhatsapp,
    crm:         company.moduleCrm,
    tickets:     company.moduleTickets,
    ai:          company.moduleAI,
    gamificacao: company.moduleGamificacao,
    projetos:    company.moduleProjetos,
    calendario:  company.moduleCalendario,
    marketing:   null,
    cofre:       null,
  };
  const flag = flagMap[module];
  if (flag === false) return denied("módulo desabilitado para a empresa");

  // 2) Feature do plano (com override custom)
  const featureKey = FEATURE_BY_MODULE[module];
  if (featureKey) {
    const plan: PlanTier = (company.subscription?.plan as PlanTier) ?? "FREE";
    const customFeatures = (company.subscription?.customFeatures as Partial<PlanFeatures> | null) ?? null;
    const planFeatures = PLANS[plan]?.features ?? PLANS.FREE.features;
    const enabled = customFeatures?.[featureKey] ?? planFeatures[featureKey];
    if (!enabled) return denied(`feature ${featureKey} não incluída no plano ${plan}`);
  }

  // 3) Bloqueia se assinatura está cancelada/inadimplente
  const status = company.subscription?.status;
  if (status === "UNPAID") return denied("assinatura inadimplente");

  return { ok: true };
}

/**
 * Versão sync para usar com `getEffectiveSession()` quando você já tem os
 * módulos da empresa carregados na sessão (impersonation injeta isso).
 * Faz checagem mais frouxa — usar só pra módulo flag, não pra feature.
 */
export function hasModuleInSession(session: any, module: ModuleName): boolean {
  const role = session?.user?.role as string | undefined;
  if (role === "SUPER_ADMIN") return true;
  const modules = (session?.user as any)?.modules ?? {};
  // Casos onde a sessão já carrega flag explícita
  if (module in modules) return modules[module] === true;
  // Demais módulos: optimistic, deixa assertModule (async) decidir
  return true;
}
