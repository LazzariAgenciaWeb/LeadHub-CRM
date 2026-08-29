import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { isClientPortalUser } from "@/lib/client-portal";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import LancamentosPanel, { type LancamentosData } from "./LancamentosPanel";
import { dueInMonth, monthKey, monthRange, shiftMonth } from "../lib";

export const dynamic = "force-dynamic";

/**
 * Lançamentos do mês — a tela OPERACIONAL do fechamento: a fila "a faturar"
 * com seleção/ignorar e as vendas fechadas na competência. A Visão geral
 * ficou com o retrato (números, meta, carteira); aqui é onde se age.
 */
export default async function LancamentosPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");
  if (await isClientPortalUser(session)) redirect("/meu-espaco");

  const role = (session.user as any)?.role as string;
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  if (!isAdmin && !can(session, "canViewFinanceiro")) redirect("/dashboard");

  const agencyId = (session.user as any)?.companyId as string | undefined;
  const isGlobal = role === "SUPER_ADMIN" && !agencyId;

  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : monthKey(new Date());
  const { from, to } = monthRange(month);

  const clients = await prisma.company.findMany({
    where: isGlobal ? { parentCompanyId: { not: null } } : { parentCompanyId: agencyId },
    select: { id: true, name: true },
  });
  const clientIds = clients.map((c) => c.id);
  const clientName = new Map(clients.map((c) => [c.id, c.name] as const));

  const [contracts, invoicesOfMonth, skips, vendasDoMes] = await Promise.all([
    prisma.clientService.findMany({
      where: { clientCompanyId: { in: clientIds }, isRecurring: true, status: "ATIVO" },
      select: {
        id: true, label: true, status: true, amountCents: true, billingCycle: true,
        renewsAt: true, clientCompanyId: true, isRecurring: true, billingDay: true,
        startedAt: true, endedAt: true,
      },
    }),
    prisma.clientInvoice.findMany({
      where: { clientCompanyId: { in: clientIds }, referenceMonth: month, status: { not: "CANCELADO" } },
      select: { amountCents: true, clientServiceId: true },
    }),
    prisma.billingSkip.findMany({
      where: { month, clientService: { clientCompanyId: { in: clientIds } } },
      select: {
        id: true, reason: true, userName: true,
        clientService: { select: { id: true, label: true, clientCompanyId: true, amountCents: true } },
      },
    }),
    prisma.sale.findMany({
      where: {
        ...(isGlobal ? {} : { companyId: agencyId ?? "__none__" }),
        closedAt: { gte: from, lt: to },
      },
      orderBy: { valueCents: "desc" },
      select: {
        id: true, title: true, valueCents: true, kind: true, billingStatus: true,
        clientCompany: { select: { name: true } },
        invoice: { select: { status: true } },
      },
    }),
  ]);

  const faturadoPorContrato = new Set(
    invoicesOfMonth.map((i) => i.clientServiceId).filter(Boolean) as string[]
  );
  const ignoradosIds = new Set(skips.map((s) => s.clientService.id));
  // Encerramento no passado tira da carteira mesmo com status esquecido em
  // Ativo — a data vale por si (mesma regra da Visão geral e da dueInMonth).
  const ativos = contracts.filter(
    (c) => !!c.amountCents && (!c.endedAt || monthKey(c.endedAt) >= month),
  );
  const devidos = ativos.filter((c) => dueInMonth(c, month) && !ignoradosIds.has(c.id));
  const pendentes = devidos.filter((c) => !faturadoPorContrato.has(c.id));

  const data: LancamentosData = {
    month,
    prevMonth: shiftMonth(month, -1),
    nextMonth: shiftMonth(month, 1),
    contratosAtivos: ativos.length,
    competencia: {
      previstoCents: devidos.reduce((s, c) => s + (c.amountCents ?? 0), 0),
      faturadoCents: invoicesOfMonth.reduce((s, i) => s + i.amountCents, 0),
      faltaFaturarCents: pendentes.reduce((s, c) => s + (c.amountCents ?? 0), 0),
    },
    pendentes: pendentes
      .map((c) => ({
        id: c.id,
        label: c.label,
        cliente: clientName.get(c.clientCompanyId) ?? "—",
        clienteId: c.clientCompanyId,
        amountCents: c.amountCents ?? 0,
        cycle: c.billingCycle ?? "MENSAL",
        billingDay: c.billingDay ?? null,
      }))
      .sort((a, b) => b.amountCents - a.amountCents),
    ignorados: skips.map((s) => ({
      skipId: s.id,
      serviceId: s.clientService.id,
      label: s.clientService.label,
      cliente: clientName.get(s.clientService.clientCompanyId) ?? "—",
      amountCents: s.clientService.amountCents ?? 0,
      reason: s.reason,
      por: s.userName,
    })),
    vendasDoMes: vendasDoMes.map((s) => ({
      id: s.id,
      title: s.title,
      cliente: s.clientCompany?.name ?? null,
      amountCents: s.valueCents,
      kind: s.kind,
      faturado: !!s.invoice,
      pago: s.invoice?.status === "PAGO",
      marcadoSemCobranca: s.billingStatus === "FATURADO" && !s.invoice,
    })),
    pontualAFaturarCents: vendasDoMes
      .filter((s) => !s.invoice)
      .reduce((n, s) => n + s.valueCents, 0),
  };

  return <LancamentosPanel data={data} />;
}
