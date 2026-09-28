import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { isClientPortalUser } from "@/lib/client-portal";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import LancamentosPanel, { type LancamentosData } from "./LancamentosPanel";
import { dueInMonth, monthKey, monthRange, nomeCliente, shiftMonth } from "../lib";

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
    select: { id: true, name: true, tradeName: true, billingNotes: true },
  });
  const clientIds = clients.map((c) => c.id);
  // Particularidades da cobrança — aparecem na linha da fila, no momento em
  // que a pessoa vai lançar.
  const clientNotes = new Map(clients.map((c) => [c.id, c.billingNotes] as const));

  // Telefone pra falar com o cliente na hora de cobrar. Preferimos o contato
  // marcado como Financeiro; sem ele, o decisor; sem ele, qualquer contato
  // real (grupo não abre conversa direta no wa.me).
  const contatos = await prisma.companyContact.findMany({
    where: { companyId: { in: clientIds }, isGroup: false },
    select: { companyId: true, phone: true, name: true, role: true },
  });
  const PESO: Record<string, number> = { FINANCIAL: 0, DECISION_MAKER: 1, CONTACT: 2, TECHNICAL: 3 };
  const clientPhone = new Map<string, { phone: string; nome: string | null }>();
  for (const ct of [...contatos].sort((a, b) => (PESO[a.role] ?? 9) - (PESO[b.role] ?? 9))) {
    if (!clientPhone.has(ct.companyId)) {
      clientPhone.set(ct.companyId, { phone: ct.phone, nome: ct.name });
    }
  }
  // Fantasia na frente, razão social entre parênteses — ver `nomeCliente`.
  const clientName = new Map(clients.map((c) => [c.id, nomeCliente(c)] as const));

  // Janela de atraso: 12 competências pra trás. Contrato que deveria ter sido
  // faturado e não foi não pode sumir da vista só porque o mês virou — é o
  // caso clássico de dinheiro esquecido.
  const mesesAtras = Array.from({ length: 12 }, (_, i) => shiftMonth(month, -(i + 1)));

  const [contracts, invoicesOfMonth, skips, vendasDoMes, invoicesAtras, skipsAtras, vendasAtrasadas] = await Promise.all([
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
        clientCompany: { select: { name: true, tradeName: true } },
        invoice: { select: { status: true } },
      },
    }),
    // Cobranças já lançadas nas competências anteriores — é a diferença entre
    // "não faturei" e "faturei e esqueci".
    prisma.clientInvoice.findMany({
      where: {
        clientCompanyId: { in: clientIds },
        referenceMonth: { in: mesesAtras },
        status: { not: "CANCELADO" },
      },
      select: { referenceMonth: true, clientServiceId: true },
    }),
    // Decisão registrada de não faturar naquele mês continua valendo.
    prisma.billingSkip.findMany({
      where: { month: { in: mesesAtras }, clientService: { clientCompanyId: { in: clientIds } } },
      select: { month: true, clientServiceId: true },
    }),
    // Venda pontual fechada antes desta competência e ainda sem cobrança — a
    // TECNURBE do mês passado precisa continuar aparecendo até ser faturada.
    prisma.sale.findMany({
      where: {
        ...(isGlobal ? {} : { companyId: agencyId ?? "__none__" }),
        closedAt: { lt: from },
        invoice: { is: null },
        billingStatus: { not: "DISPENSADO" },
      },
      orderBy: { closedAt: "asc" },
      take: 100,
      select: {
        id: true, title: true, valueCents: true, kind: true, closedAt: true, billingStatus: true,
        clientCompany: { select: { name: true, tradeName: true } },
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

  // ── Atrasados: o que era devido em meses anteriores e nunca foi faturado ──
  // Chave (contrato, competência) pra não confundir "faturei em julho" com
  // "faturei em agosto" — o mesmo contrato tem uma pendência por mês.
  const faturadoAtras = new Set(
    invoicesAtras
      .filter((i) => i.clientServiceId)
      .map((i) => `${i.clientServiceId}:${i.referenceMonth}`),
  );
  const ignoradoAtras = new Set(skipsAtras.map((s) => `${s.clientServiceId}:${s.month}`));

  // Antes da adoção do sistema não existe cobrança lançada em lugar nenhum —
  // sem esta trava, todo contrato ativo viraria 12 "atrasos" fantasmas no
  // primeiro acesso. A primeira competência COM cobrança marca o início do
  // controle; o que veio antes disso foi faturado fora daqui.
  const primeiraCompetencia = [...invoicesAtras.map((i) => i.referenceMonth), month]
    .filter((m): m is string => !!m)
    .sort()[0];

  const atrasados: {
    id: string; label: string; cliente: string; clienteId: string;
    amountCents: number; billingDay: number | null; competencia: string;
  }[] = [];
  for (const c of contracts) {
    if (!c.amountCents) continue;
    for (const m of mesesAtras) {
      if (m < primeiraCompetencia) continue;
      if (!dueInMonth(c, m)) continue;
      if (faturadoAtras.has(`${c.id}:${m}`)) continue;
      if (ignoradoAtras.has(`${c.id}:${m}`)) continue;
      atrasados.push({
        id: c.id,
        label: c.label,
        cliente: clientName.get(c.clientCompanyId) ?? "—",
        clienteId: c.clientCompanyId,
        amountCents: c.amountCents ?? 0,
        billingDay: c.billingDay ?? null,
        competencia: m,
      });
    }
  }
  // Mais antigo primeiro: é o que está esquecido há mais tempo.
  atrasados.sort((a, b) => a.competencia.localeCompare(b.competencia));

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
        obs: clientNotes.get(c.clientCompanyId) ?? null,
        whatsapp: clientPhone.get(c.clientCompanyId)?.phone.replace(/\D/g, "") ?? null,
        contato: clientPhone.get(c.clientCompanyId)?.nome ?? null,
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
      cliente: s.clientCompany ? nomeCliente(s.clientCompany) : null,
      amountCents: s.valueCents,
      kind: s.kind,
      faturado: !!s.invoice,
      pago: s.invoice?.status === "PAGO",
      marcadoSemCobranca: s.billingStatus === "FATURADO" && !s.invoice,
    })),
    pontualAFaturarCents: vendasDoMes
      .filter((s) => !s.invoice)
      .reduce((n, s) => n + s.valueCents, 0),
    atrasados,
    vendasAtrasadas: vendasAtrasadas
      // Mesma trava dos contratos: venda anterior ao início do controle foi
      // faturada fora do sistema e não é pendência de verdade.
      .filter((s) => monthKey(s.closedAt) >= primeiraCompetencia)
      .map((s) => ({
        id: s.id,
        title: s.title,
        cliente: s.clientCompany ? nomeCliente(s.clientCompany) : null,
        amountCents: s.valueCents,
        kind: s.kind,
        closedAt: s.closedAt.toISOString(),
        // Marcada como faturada na esteira mas sem cobrança gerada: pendência
        // com causa diferente (faltou vincular o cliente).
        marcadoSemCobranca: s.billingStatus === "FATURADO",
      })),
  };

  return <LancamentosPanel data={data} />;
}
