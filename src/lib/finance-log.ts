import { prisma } from "@/lib/prisma";

/**
 * Trilha de auditoria do financeiro — responde "quem encerrou/reabriu/pagou
 * isso, quando e por quê" quando os números divergem na conferência.
 *
 * Fire-and-forget de propósito: falha no log NUNCA pode derrubar a operação
 * que está sendo logada (o contrário — operação ok e log perdido — é o mal
 * menor, e fica no console).
 */
export async function logFinance(evt: {
  companyId: string;
  clientCompanyId?: string | null;
  entity: "CONTRATO" | "COBRANCA";
  entityId?: string | null;
  action: string;
  description?: string | null;
  meta?: Record<string, unknown>;
  session?: any;
}) {
  try {
    await prisma.financeLog.create({
      data: {
        companyId: evt.companyId,
        clientCompanyId: evt.clientCompanyId ?? null,
        entity: evt.entity,
        entityId: evt.entityId ?? null,
        action: evt.action,
        description: evt.description?.trim() || null,
        meta: (evt.meta as any) ?? undefined,
        userName: evt.session?.user?.name ?? evt.session?.user?.email ?? null,
      },
    });
  } catch (e) {
    console.error("[finance-log]", e);
  }
}

/** Agência dona da carteira de um cliente — o escopo dos logs. */
export async function agencyOf(clientCompanyId: string): Promise<string> {
  const c = await prisma.company.findUnique({
    where: { id: clientCompanyId },
    select: { id: true, parentCompanyId: true },
  });
  return c?.parentCompanyId ?? c?.id ?? clientCompanyId;
}
