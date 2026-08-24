import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { monthKey, monthRange, shiftMonth, dueInMonth } from "../lib";
import BonificacaoPanel, { type BonificacaoData } from "./BonificacaoPanel";

export const dynamic = "force-dynamic";

export default async function BonificacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const role = (session.user as any)?.role as string;
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  if (!isAdmin && !can(session, "canViewFinanceiro")) redirect("/dashboard");

  const agencyId = (session.user as any)?.companyId as string | undefined;
  if (!agencyId) {
    return <BonificacaoPanel data={null} />;
  }

  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : monthKey(new Date());
  const { from, to } = monthRange(month);

  const clients = await prisma.company.findMany({
    where: { parentCompanyId: agencyId },
    select: { id: true, name: true },
  });
  const clientIds = clients.map((c) => c.id);
  const nomeCliente = new Map(clients.map((c) => [c.id, c.name] as const));

  const [contratos, faturas, vendas, bonus, colaboradores] = await Promise.all([
    prisma.clientService.findMany({
      where: { clientCompanyId: { in: clientIds }, isRecurring: true, status: "ATIVO" },
      select: {
        id: true, label: true, amountCents: true, billingCycle: true,
        renewsAt: true, isRecurring: true, status: true, clientCompanyId: true,
      },
    }),
    // Faturas da competência: é o gatilho do recorrente — faturou e o cliente
    // está ativo, paga, entregue ou não.
    prisma.clientInvoice.findMany({
      where: { clientCompanyId: { in: clientIds }, referenceMonth: month, status: { not: "CANCELADO" } },
      select: { clientServiceId: true },
    }),
    // Pontual: o gatilho é a ENTREGA, não o faturamento.
    prisma.sale.findMany({
      where: { companyId: agencyId, productionStatus: "ENTREGUE", deliveredAt: { gte: from, lt: to } },
      select: {
        id: true, title: true, valueCents: true, deliveredAt: true,
        clientCompany: { select: { name: true } },
      },
      orderBy: { deliveredAt: "desc" },
    }),
    prisma.bonus.findMany({
      where: { companyId: agencyId, month },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }],
      include: {
        sale: { select: { id: true, title: true } },
        clientService: { select: { id: true, label: true, clientCompanyId: true } },
      },
    }),
    prisma.user.findMany({
      // SUPER_ADMIN é dono da plataforma, não executa serviço de cliente.
      where: { companyId: agencyId, role: { not: "SUPER_ADMIN" } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const faturados = new Set(faturas.map((f) => f.clientServiceId).filter(Boolean) as string[]);

  const data: BonificacaoData = {
    month,
    prevMonth: shiftMonth(month, -1),
    nextMonth: shiftMonth(month, 1),
    colaboradores: colaboradores.map((u) => ({ id: u.id, nome: u.name ?? u.email })),
    recorrentes: contratos
      .filter((c) => dueInMonth(c, month))
      .map((c) => ({
        id: c.id,
        cliente: nomeCliente.get(c.clientCompanyId) ?? "—",
        label: c.label,
        // Tipo = o que vem antes do travessão no rótulo, que é o SERVICO da
        // origem. Serve pros filtros: hospedagem não bonifica.
        tipo: c.label.split(" — ")[0].trim(),
        amountCents: c.amountCents ?? 0,
        faturado: faturados.has(c.id),
      }))
      .sort((a, b) => a.cliente.localeCompare(b.cliente)),
    pontuais: vendas.map((v) => ({
      id: v.id,
      titulo: v.title,
      cliente: v.clientCompany?.name ?? null,
      valorCents: v.valueCents,
      entregueEm: v.deliveredAt!.toISOString(),
    })),
    lancados: bonus.map((b) => ({
      id: b.id,
      nome: b.name,
      amountCents: b.amountCents,
      pago: !!b.paidAt,
      origem: b.sale
        ? { tipo: "venda" as const, id: b.sale.id, descricao: b.sale.title }
        : b.clientService
          ? {
              tipo: "contrato" as const,
              id: b.clientService.id,
              descricao: `${nomeCliente.get(b.clientService.clientCompanyId) ?? "—"} · ${b.clientService.label}`,
            }
          : { tipo: "avulso" as const, id: "", descricao: "—" },
    })),
  };

  return <BonificacaoPanel data={data} />;
}
