import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { dueInMonth, monthRange } from "@/app/(admin)/financeiro/lib";

/**
 * POST /api/financeiro/faturar
 * Body: { month: "YYYY-MM", serviceIds?: string[], dueDay?: number }
 *
 * Lança as cobranças dos contratos recorrentes devidos na competência —
 * o "dei baixa no faturamento do mês" que hoje só existia abrindo cada
 * empresa e criando a cobrança à mão, uma por uma.
 *
 * Sem `serviceIds`, fatura TODOS os pendentes do mês. Idempotente: contrato
 * que já tem cobrança na competência é pulado, então repetir a ação não
 * duplica nada (e serve de conferência — devolve quantos ficaram de fora).
 */
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any)?.role as string;
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  if (!isAdmin && !can(session, "canViewFinanceiro")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  const agencyId = (session.user as any)?.companyId as string | undefined;
  const isGlobal = role === "SUPER_ADMIN" && !agencyId;

  const body = await req.json().catch(() => ({}));
  const month = String(body?.month ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "Competência inválida" }, { status: 400 });
  }
  const onlyIds: string[] | null = Array.isArray(body?.serviceIds) && body.serviceIds.length > 0
    ? body.serviceIds.map(String)
    : null;

  // Vencimento cai DENTRO da competência — cobrança recorrente vence no mês de
  // referência, não "hoje + N". O dia do corpo é só o padrão de quem não tem
  // `billingDay` combinado no contrato; mês curto puxa pro último dia.
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const fallbackDay = Math.min(Math.max(parseInt(String(body?.dueDay ?? 10), 10) || 10, 1), lastDay);
  const dueDateFor = (billingDay: number | null) => {
    const day = Math.min(Math.max(billingDay ?? fallbackDay, 1), lastDay);
    return new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
  };

  // Carteira da agência — o mesmo escopo da Visão geral.
  const clients = await prisma.company.findMany({
    where: isGlobal ? { parentCompanyId: { not: null } } : { parentCompanyId: agencyId },
    select: { id: true },
  });
  const clientIds = clients.map((c) => c.id);
  if (clientIds.length === 0) {
    return NextResponse.json({ created: 0, skipped: 0, totalCents: 0 });
  }

  const [contracts, existing, skips] = await Promise.all([
    prisma.clientService.findMany({
      where: {
        clientCompanyId: { in: clientIds },
        isRecurring: true,
        status: "ATIVO",
        ...(onlyIds ? { id: { in: onlyIds } } : {}),
      },
      select: {
        id: true, label: true, amountCents: true, billingCycle: true,
        renewsAt: true, isRecurring: true, clientCompanyId: true, status: true,
        billingDay: true, startedAt: true, endedAt: true,
      },
    }),
    prisma.clientInvoice.findMany({
      where: { clientCompanyId: { in: clientIds }, referenceMonth: month, status: { not: "CANCELADO" } },
      select: { clientServiceId: true },
    }),
    // Ignorados desta competência: nem o "Faturar todos" passa por cima —
    // ignorar com motivo e o lote cobrar mesmo assim seria pior que não ter
    // o recurso.
    prisma.billingSkip.findMany({
      where: { month, clientService: { clientCompanyId: { in: clientIds } } },
      select: { clientServiceId: true },
    }),
  ]);

  const jaFaturado = new Set(existing.map((i) => i.clientServiceId).filter(Boolean) as string[]);
  const ignorados = new Set(skips.map((s) => s.clientServiceId));

  // Mesmo filtro da tela: só contrato com valor e devido nesta competência.
  const alvo = contracts.filter(
    (c) => !!c.amountCents && dueInMonth(c, month) && !jaFaturado.has(c.id) && !ignorados.has(c.id),
  );
  const skipped = contracts.length - alvo.length;

  if (alvo.length === 0) {
    return NextResponse.json({ created: 0, skipped, totalCents: 0 });
  }

  const result = await prisma.clientInvoice.createMany({
    data: alvo.map((c) => ({
      clientCompanyId: c.clientCompanyId,
      clientServiceId: c.id,
      description: c.label,
      referenceMonth: month,
      amountCents: c.amountCents ?? 0,
      dueDate: dueDateFor(c.billingDay),
      status: "ABERTO",
      provider: "manual",
    })),
  });

  // Trilha: uma linha por cobrança lançada, no cliente certo — é o que
  // responde "quem faturou isso e quando" na conferência.
  const userName = (session.user as any)?.name ?? (session.user as any)?.email ?? null;
  await prisma.financeLog
    .createMany({
      data: alvo.map((c) => ({
        companyId: agencyId ?? "GLOBAL",
        clientCompanyId: c.clientCompanyId,
        entity: "COBRANCA",
        entityId: c.id,
        action: "FATURADO",
        description: `Lote de ${month}`,
        meta: { contrato: c.label, competencia: month, valorCents: c.amountCents ?? 0 },
        userName,
      })),
    })
    .catch((e) => console.error("[finance-log lote]", e));

  return NextResponse.json({
    created: result.count,
    skipped,
    totalCents: alvo.reduce((n, c) => n + (c.amountCents ?? 0), 0),
  });
}
