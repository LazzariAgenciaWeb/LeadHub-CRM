import { prisma } from "@/lib/prisma";
import { getCompanyPlan } from "@/lib/limits";

/**
 * O assistente pessoal NÃO vem em plano nenhum: só por exceção
 * (Subscription.customFeatures.assistentePessoal) — decisão 2026-09-28.
 * SUPER_ADMIN sempre pode. Usado nas portas que não têm sessão (WhatsApp,
 * MCP, cron); as rotas com sessão usam `hasModule(session, "assistentePessoal")`.
 */
export async function userCanUseAssistant(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, companyId: true } });
  if (!user) return false;
  if (user.role === "SUPER_ADMIN") return true;
  if (!user.companyId) return false;
  try {
    const ctx = await getCompanyPlan(user.companyId);
    return !!ctx.effectiveFeatures.assistentePessoal;
  } catch {
    return false;
  }
}
