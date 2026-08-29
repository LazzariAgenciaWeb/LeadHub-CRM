import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { isClientPortalUser } from "@/lib/client-portal";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import EsteiraPanel, { type EsteiraData } from "./EsteiraPanel";

export const dynamic = "force-dynamic";

export default async function EsteiraPage() {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  // Gestão interna da agência: empresa-cliente que entra no sistema não abre
  // esta área — esconder no menu não basta, a rota é adivinhável.
  if (await isClientPortalUser(session)) redirect("/meu-espaco");

  const role = (session.user as any)?.role as string;
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  // Defesa em profundidade: esconder no menu não basta, a rota é adivinhável.
  if (!isAdmin && !can(session, "canViewFinanceiro")) redirect("/dashboard");

  const agencyId = (session.user as any)?.companyId as string | undefined;
  const isGlobal = role === "SUPER_ADMIN" && !agencyId;

  const [sales, clients, colaboradores] = await Promise.all([
    prisma.sale.findMany({
      where: isGlobal ? {} : { companyId: agencyId ?? "__none__" },
      orderBy: { closedAt: "desc" },
      take: 300,
      include: {
        clientCompany: { select: { id: true, name: true } },
        lead: { select: { id: true } },
        // Cobrança gerada ao marcar "Faturado" — a esteira mostra vencimento e
        // se já foi paga, senão o usuário marca faturado e não vê pra onde foi.
        invoice: { select: { id: true, dueDate: true, status: true, amountCents: true } },
      },
    }),
    prisma.company.findMany({
      where: isGlobal ? { parentCompanyId: { not: null } } : { parentCompanyId: agencyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // Responsáveis possíveis — mesma lista da Bonificação. SUPER_ADMIN é dono
    // da plataforma, não executa serviço de cliente.
    agencyId
      ? prisma.user.findMany({
          where: { companyId: agencyId, role: { not: "SUPER_ADMIN" } },
          select: { id: true, name: true, email: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const data: EsteiraData = {
    isGlobal,
    clients,
    colaboradores: colaboradores.map((u) => ({ id: u.id, nome: u.name ?? u.email })),
    sales: sales.map((s) => ({
      id: s.id,
      title: s.title,
      valueCents: s.valueCents,
      kind: s.kind,
      closedAt: s.closedAt.toISOString(),
      sellerName: s.sellerName,
      responsibleId: s.responsibleId,
      responsibleName: s.responsibleName,
      leadId: s.lead?.id ?? null,
      client: s.clientCompany,
      contractStatus: s.contractStatus,
      billingStatus: s.billingStatus,
      productionStatus: s.productionStatus,
      invoice: s.invoice
        ? {
            id: s.invoice.id,
            dueDate: s.invoice.dueDate.toISOString(),
            status: s.invoice.status,
            amountCents: s.invoice.amountCents,
          }
        : null,
    })),
  };

  return <EsteiraPanel data={data} />;
}
