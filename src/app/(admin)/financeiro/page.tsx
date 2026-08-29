import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { isClientPortalUser } from "@/lib/client-portal";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import FinanceiroVisaoGeral, { type VisaoGeralData } from "./FinanceiroVisaoGeral";
import { dueInMonth, monthKey, monthlyEquivalentCents, monthRange, shiftMonth } from "./lib";

export const dynamic = "force-dynamic";

export default async function FinanceiroPage({
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
  // Defesa em profundidade: esconder no menu não basta, a rota é adivinhável.
  if (!isAdmin && !can(session, "canViewFinanceiro")) redirect("/dashboard");

  const agencyId = (session.user as any)?.companyId as string | undefined;
  const isGlobal = role === "SUPER_ADMIN" && !agencyId;

  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : monthKey(new Date());
  const { from, to } = monthRange(month);

  // Carteira: as empresas-cliente desta agência. SUPER_ADMIN sem empresa vê
  // todos os clientes cadastrados (visão global da plataforma).
  const clients = await prisma.company.findMany({
    where: isGlobal ? { parentCompanyId: { not: null } } : { parentCompanyId: agencyId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const clientIds = clients.map((c) => c.id);
  const clientName = new Map(clients.map((c) => [c.id, c.name] as const));

  // Escopo dos leads é OUTRO: lead pertence à agência, não ao cliente dela.
  const leadWhere = isGlobal ? {} : { companyId: agencyId ?? "__none__" };

  const [contracts, invoicesOfMonth, paidInMonth, openInvoices, target, leads, promotions, leadsEnteredMonth] =
    await Promise.all([
      prisma.clientService.findMany({
        where: { clientCompanyId: { in: clientIds }, isRecurring: true },
        select: {
          id: true, label: true, status: true, amountCents: true, billingCycle: true,
          renewsAt: true, clientCompanyId: true, isRecurring: true, billingDay: true,
          startedAt: true, endedAt: true,
        },
      }),
      // Faturas da competência (o que já foi lançado pro mês).
      prisma.clientInvoice.findMany({
        where: { clientCompanyId: { in: clientIds }, referenceMonth: month, status: { not: "CANCELADO" } },
        select: { id: true, amountCents: true, clientServiceId: true, status: true },
      }),
      prisma.clientInvoice.aggregate({
        where: { clientCompanyId: { in: clientIds }, status: "PAGO", paidAt: { gte: from, lt: to } },
        _sum: { amountCents: true },
        _count: true,
      }),
      // Tudo que segue em aberto, pra separar a vencer × vencido.
      prisma.clientInvoice.findMany({
        where: { clientCompanyId: { in: clientIds }, status: "ABERTO" },
        select: { amountCents: true, dueDate: true },
      }),
      agencyId
        ? prisma.monthlyTarget.findUnique({ where: { companyId_month: { companyId: agencyId, month } } })
        : Promise.resolve(null),
      prisma.lead.findMany({
        where: { ...leadWhere, pipeline: "OPORTUNIDADES" },
        select: { id: true, value: true, status: true, wonAt: true, lostAt: true, updatedAt: true },
      }),
      // Promoções pra OPORTUNIDADES no mês — numerador da conversão.
      prisma.activity.findMany({
        where: { ...leadWhere, type: "PIPELINE_CHANGED", createdAt: { gte: from, lt: to } },
        select: { meta: true },
      }),
      // Leads que entraram no funil no mês — denominador da conversão.
      prisma.lead.count({
        where: { ...leadWhere, pipeline: { in: ["LEADS", "OPORTUNIDADES"] }, createdAt: { gte: from, lt: to } },
      }),
    ]);

  // Esteira: o que está parado. Contado sobre TODAS as vendas, não só as do
  // mês — uma venda de março que nunca virou contrato continua sendo pendência
  // hoje, e sumiria se o recorte fosse por competência.
  const esteira = await prisma.sale.groupBy({
    by: ["contractStatus", "billingStatus", "productionStatus", "clientCompanyId"],
    where: isGlobal ? {} : { companyId: agencyId ?? "__none__" },
    _count: { _all: true },
  });

  // Vendas fechadas na competência — a lista que responde "o que vendi neste
  // mês e quanto disso já virou cobrança". Os cards do topo só falam de
  // contrato recorrente, então venda pontual não aparecia em lugar nenhum.
  const vendasDoMes = await prisma.sale.findMany({
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
  });
  const somaSe = (pred: (g: (typeof esteira)[number]) => boolean) =>
    esteira.filter(pred).reduce((n, g) => n + g._count._all, 0);

  // ── Recorrência ───────────────────────────────────────────────────────────
  const mrrCents = contracts.reduce((s, c) => s + monthlyEquivalentCents(c), 0);
  const ativos = contracts.filter((c) => c.status === "ATIVO" && c.amountCents);

  const faturadoPorContrato = new Set(
    invoicesOfMonth.map((i) => i.clientServiceId).filter(Boolean) as string[]
  );
  const devidos = ativos.filter((c) => dueInMonth(c, month));
  const pendentes = devidos.filter((c) => !faturadoPorContrato.has(c.id));

  const previstoCents = devidos.reduce((s, c) => s + (c.amountCents ?? 0), 0);
  const faltaFaturarCents = pendentes.reduce((s, c) => s + (c.amountCents ?? 0), 0);
  const faturadoCents = invoicesOfMonth.reduce((s, i) => s + i.amountCents, 0);

  const hoje = new Date();
  const aVencerCents = openInvoices.filter((i) => i.dueDate >= hoje).reduce((s, i) => s + i.amountCents, 0);
  const atrasadoCents = openInvoices.filter((i) => i.dueDate < hoje).reduce((s, i) => s + i.amountCents, 0);
  const atrasadoQtd = openInvoices.filter((i) => i.dueDate < hoje).length;

  // ── Comercial ─────────────────────────────────────────────────────────────
  const abertos = leads.filter((l) => l.status !== "CLOSED" && l.status !== "LOST");
  // SEM fallback pra `updatedAt`. A migration `20260824_lead_outcome_dates`
  // carimbou wonAt/lostAt na base inteira, então o fallback deixou de ser rede
  // de segurança e virou bug: qualquer edição num lead ganho meses atrás
  // (mudar telefone, anexar nota) reescreve `updatedAt` e ressuscita a venda na
  // competência corrente. Era isso que inflava o "ganho do mês" muito acima da
  // soma das vendas listadas. Lead sem carimbo agora simplesmente não conta.
  const inRange = (d: Date | null) => !!d && d >= from && d < to;
  const ganhos = leads.filter((l) => l.status === "CLOSED" && inRange(l.wonAt));
  const perdas = leads.filter((l) => l.status === "LOST" && inRange(l.lostAt));
  const sum = (arr: { value: number | null }[]) => Math.round(arr.reduce((s, l) => s + (l.value ?? 0), 0) * 100);

  const promovidos = promotions.filter(
    (a) => (a.meta as { to?: string } | null)?.to === "OPORTUNIDADES"
  ).length;

  const data: VisaoGeralData = {
    esteira: {
      semCliente: somaSe((g) => g.clientCompanyId === null),
      semContrato: somaSe((g) => g.contractStatus === "PENDENTE" || g.contractStatus === "ENVIADO"),
      semFatura: somaSe((g) => g.billingStatus === "PENDENTE"),
      semProducao: somaSe((g) => g.productionStatus === "PENDENTE" || g.productionStatus === "LIBERADO"),
    },
    month,
    prevMonth: shiftMonth(month, -1),
    nextMonth: shiftMonth(month, 1),
    isGlobal,
    canSetTarget: !!agencyId,
    carteira: {
      clientes: clients.length,
      contratosAtivos: ativos.length,
      mrrCents,
    },
    competencia: {
      previstoCents,
      faturadoCents,
      faltaFaturarCents,
      recebidoCents: paidInMonth._sum.amountCents ?? 0,
      recebidoQtd: paidInMonth._count,
      aVencerCents,
      atrasadoCents,
      atrasadoQtd,
    },
    pendentes: pendentes
      .map((c) => ({
        id: c.id,
        label: c.label,
        cliente: clientName.get(c.clientCompanyId) ?? "—",
        clienteId: c.clientCompanyId,
        amountCents: c.amountCents ?? 0,
        cycle: c.billingCycle ?? "MENSAL",
        // Dia de vencimento combinado no contrato. Quando existe, a cobrança
        // deve vencer nele — não no dia único escolhido pro lote.
        billingDay: c.billingDay ?? null,
      }))
      .sort((a, b) => b.amountCents - a.amountCents),
    comercial: {
      abertoCents: sum(abertos),
      abertoQtd: abertos.length,
      ganhoCents: sum(ganhos),
      ganhoQtd: ganhos.length,
      perdaCents: sum(perdas),
      perdaQtd: perdas.length,
      leadsNoMes: leadsEnteredMonth,
      promovidosNoMes: promovidos,
    },
    meta: {
      revenueTargetCents: target?.revenueTargetCents ?? 0,
      newSalesTargetCents: target?.newSalesTargetCents ?? 0,
    },
    vendasDoMes: vendasDoMes.map((s) => ({
      id: s.id,
      title: s.title,
      cliente: s.clientCompany?.name ?? null,
      amountCents: s.valueCents,
      kind: s.kind,
      // "Faturado" de verdade = tem cobrança. O status sozinho pode estar
      // marcado sem cobrança (venda sem cliente vinculado).
      faturado: !!s.invoice,
      pago: s.invoice?.status === "PAGO",
      // Marcado como faturado na esteira mas sem cobrança gerada — precisa
      // aparecer como pendência, senão o número do mês fica devendo sem motivo
      // visível.
      marcadoSemCobranca: s.billingStatus === "FATURADO" && !s.invoice,
    })),
    pontualAFaturarCents: vendasDoMes
      .filter((s) => !s.invoice)
      .reduce((n, s) => n + s.valueCents, 0),
  };

  return <FinanceiroVisaoGeral data={data} />;
}
