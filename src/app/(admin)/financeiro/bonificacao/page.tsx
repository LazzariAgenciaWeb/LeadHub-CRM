import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { isClientPortalUser } from "@/lib/client-portal";
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

  // Gestão interna da agência: empresa-cliente que entra no sistema não abre
  // esta área — esconder no menu não basta, a rota é adivinhável.
  if (await isClientPortalUser(session)) redirect("/meu-espaco");

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
        bonusEligible: true, startedAt: true,
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
        id: true, title: true, valueCents: true, deliveredAt: true, bonusEligible: true,
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
    // Serviços tirados do fechamento — visíveis dobrados no fim da lista,
    // senão "marquei sem querer" não tem caminho de volta fora do cadastro.
    naoBonificam: [
      ...contratos
        .filter((c) => !c.bonusEligible)
        .map((c) => ({
          id: c.id,
          tipo: "contrato" as const,
          clienteId: c.clientCompanyId,
          nome: `${nomeCliente.get(c.clientCompanyId) ?? "—"} · ${c.label}`,
        })),
      ...vendas
        .filter((v) => !v.bonusEligible)
        .map((v) => ({
          id: v.id,
          tipo: "venda" as const,
          clienteId: "",
          nome: `${v.clientCompany?.name ?? "—"} · ${v.title} (pontual)`,
        })),
    ].sort((a, b) => a.nome.localeCompare(b.nome)),
    recorrentes: contratos
      // Serviço marcado como "não bonifica" sai da lista — é a hospedagem que
      // todo mês era ignorada à mão. Lançamento JÁ FEITO continua na lista de
      // lançados: desligar a flag não pode sumir com histórico de pagamento.
      .filter((c) => c.bonusEligible && dueInMonth(c, month))
      .map((c) => ({
        id: c.id,
        clienteId: c.clientCompanyId,
        cliente: nomeCliente.get(c.clientCompanyId) ?? "—",
        label: c.label,
        // Tipo = o que vem antes do travessão no rótulo, que é o SERVICO da
        // origem. Serve pros filtros: hospedagem não bonifica.
        tipo: c.label.split(" — ")[0].trim(),
        amountCents: c.amountCents ?? 0,
        faturado: faturados.has(c.id),
      }))
      .sort((a, b) => a.cliente.localeCompare(b.cliente)),
    pontuais: vendas
      .filter((v) => v.bonusEligible)
      .map((v) => ({
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
      serviceValueCents: b.serviceValueCents,
      pago: !!b.paidAt,
      pagoEm: b.paidAt?.toISOString() ?? null,
      origem: b.sale
        ? { tipo: "venda" as const, id: b.sale.id, descricao: b.sale.title }
        : b.clientService
          ? {
              tipo: "contrato" as const,
              id: b.clientService.id,
              descricao: `${nomeCliente.get(b.clientService.clientCompanyId) ?? "—"} · ${b.clientService.label}`,
            }
          : { tipo: "avulso" as const, id: "", descricao: b.notes ?? "Serviço avulso" },
    })),
  };

  return <BonificacaoPanel data={data} />;
}
