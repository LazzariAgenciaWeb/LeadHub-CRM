import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { isClientPortalUser } from "@/lib/client-portal";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import EsteiraPanel, { type EsteiraData } from "./EsteiraPanel";
import { nomeCliente } from "../lib";

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

  const [sales, clients, colaboradores, projetos] = await Promise.all([
    prisma.sale.findMany({
      where: isGlobal ? {} : { companyId: agencyId ?? "__none__" },
      orderBy: { closedAt: "desc" },
      take: 300,
      include: {
        clientCompany: { select: { id: true, name: true, tradeName: true } },
        lead: { select: { id: true } },
        // Cobrança gerada ao marcar "Faturado" — a esteira mostra vencimento e
        // se já foi paga, senão o usuário marca faturado e não vê pra onde foi.
        project: { select: { id: true, name: true, status: true, taskCount: true, taskCompleted: true } },
        invoices: {
          orderBy: { dueDate: "asc" },
          select: { id: true, dueDate: true, status: true, amountCents: true, installment: true, installments: true },
        },
      },
    }),
    prisma.company.findMany({
      where: isGlobal ? { parentCompanyId: { not: null } } : { parentCompanyId: agencyId },
      select: { id: true, name: true, tradeName: true },
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
    // Projetos em aberto pra vincular. Entregue/cancelado fica de fora: a
    // venda que está entrando em produção não se liga a projeto encerrado.
    prisma.setorClickupList.findMany({
      where: {
        ...(isGlobal ? {} : { setor: { companyId: agencyId ?? "__none__" } }),
        status: { notIn: ["ENTREGUE", "CANCELADO"] },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, clientCompanyId: true },
    }),
  ]);

  const data: EsteiraData = {
    isGlobal,
    // Fantasia na frente no seletor e nos cards — ver `nomeCliente`.
    clients: clients.map((c) => ({ id: c.id, name: nomeCliente(c) })),
    colaboradores: colaboradores.map((u) => ({ id: u.id, nome: u.name ?? u.email })),
    projetos: projetos.map((p) => ({ id: p.id, nome: p.name, clienteId: p.clientCompanyId })),
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
      client: s.clientCompany
        ? { id: s.clientCompany.id, name: nomeCliente(s.clientCompany) }
        : null,
      contractStatus: s.contractStatus,
      billingStatus: s.billingStatus,
      productionStatus: s.productionStatus,
      deliveredAt: s.deliveredAt?.toISOString() ?? null,
      notes: s.notes,
      project: s.project
        ? {
            id: s.project.id,
            name: s.project.name,
            status: s.project.status,
            taskCount: s.project.taskCount,
            taskCompleted: s.project.taskCompleted,
          }
        : null,
      invoices: s.invoices.map((i) => ({
        id: i.id,
        dueDate: i.dueDate.toISOString(),
        status: i.status,
        amountCents: i.amountCents,
        installment: i.installment,
        installments: i.installments,
      })),
    })),
  };

  return <EsteiraPanel data={data} />;
}
