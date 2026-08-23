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
  type PlanFeatures,
  type PlanTier,
} from "./plans";
import { MODULE_BY_ID, effectiveFeatures } from "./modules";

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
  | "projetos"
  | "clickup"
  | "emailMarketing"
  | "emailInbox"
  | "instagram"
  | "espacoCliente"
  | "videos";

export type ModuleGateResult =
  | { ok: true }
  | { ok: false; reason: string; response: NextResponse };

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
/**
 * Gate de FEATURE (mais fino que o módulo). Existe porque um módulo pode ser
 * comum a todos os planos e ainda ter partes que só o plano de cima entrega:
 * o Dashboard de Marketing está em todos, mas Google Ads e Meta Ads só do
 * Marketing pra cima. Sem isto a separação seria só visual — bastava conectar
 * a conta pra ver o dado pago.
 */
export async function assertFeature(
  session: any,
  feature: keyof PlanFeatures,
): Promise<ModuleGateResult> {
  const role = session?.user?.role as string | undefined;
  if (role === "SUPER_ADMIN") return { ok: true };
  if ((session as any)?._impersonating) return { ok: true };

  const companyId = session?.user?.companyId as string | undefined;
  if (!companyId) return denied("sem companyId na sessão");

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { subscription: { select: { plan: true, status: true, customFeatures: true } } },
  });
  if (!company) return denied("empresa não encontrada");

  const tier: PlanTier = (company.subscription?.plan as PlanTier) ?? "FREE";
  const custom = (company.subscription?.customFeatures as Partial<PlanFeatures> | null) ?? null;
  if (!effectiveFeatures(tier, custom)[feature]) {
    return denied(`recurso ${feature} não incluído no plano`);
  }
  if (company.subscription?.status === "UNPAID") return denied("assinatura inadimplente");
  return { ok: true };
}

export async function assertModule(
  session: any,
  module: ModuleName,
): Promise<ModuleGateResult> {
  const role = session?.user?.role as string | undefined;
  if (role === "SUPER_ADMIN") return { ok: true };

  // SUPER_ADMIN em modo impersonação tem role="ADMIN" no effective session,
  // mas mantém o flag _impersonating. Liberamos o gate aqui para que o super
  // admin possa configurar/testar tudo dentro do contexto da empresa cliente
  // sem ser bloqueado por flag de módulo ou feature do plano.
  if ((session as any)?._impersonating) return { ok: true };

  const companyId = session?.user?.companyId as string | undefined;
  if (!companyId) return denied("sem companyId na sessão");

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      subscription: { select: { plan: true, status: true, customFeatures: true } },
    },
  });
  if (!company) return denied("empresa não encontrada");

  // Fonte ÚNICA: plano + exceções da assinatura. Os `Company.module*` deixaram
  // de ser entrada — viraram cache derivado deste mesmo cálculo (ver
  // src/lib/modules.ts). Antes eram uma terceira fonte, e a precedência entre
  // as três é o que tornava o comportamento imprevisível: `moduleX = false`
  // era ao mesmo tempo default do schema e "desliguei de propósito".
  const tier: PlanTier = (company.subscription?.plan as PlanTier) ?? "FREE";
  const custom = (company.subscription?.customFeatures as Partial<PlanFeatures> | null) ?? null;
  const features = effectiveFeatures(tier, custom);

  const def = MODULE_BY_ID[module];
  if (def) {
    const keys = [def.primary, ...(def.alsoEnabledBy ?? [])];
    if (!keys.some((k) => features[k])) {
      return denied(`módulo ${def.label} não liberado para esta empresa`);
    }
  }

  // Bloqueia se assinatura está cancelada/inadimplente
  if (company.subscription?.status === "UNPAID") return denied("assinatura inadimplente");

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
