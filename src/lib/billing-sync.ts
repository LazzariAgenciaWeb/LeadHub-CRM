import { prisma } from "./prisma";
import { getCompanyPlan } from "./limits";
import { companyFlagsFromFeatures } from "./modules";

/**
 * Regrava o cache `Company.module*` depois que o plano muda sozinho (webhook da
 * Stripe, vencimento). Sem isso o cliente paga e o menu continua no plano antigo.
 */
export async function syncCompanyModuleFlags(companyId: string): Promise<void> {
  const ctx = await getCompanyPlan(companyId);
  await prisma.company.update({
    where: { id: companyId },
    data: companyFlagsFromFeatures(ctx.effectiveFeatures),
  });
}
