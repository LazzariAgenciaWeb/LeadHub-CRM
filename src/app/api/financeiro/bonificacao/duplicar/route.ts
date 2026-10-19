import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { dueInMonth, shiftMonth } from "@/app/(admin)/financeiro/lib";

/**
 * POST /api/financeiro/bonificacao/duplicar — Body: { month }
 *
 * Replica na competência `month` os lançamentos de CONTRATO RECORRENTE do mês
 * anterior: mesmo colaborador, mesmo valor de serviço, mesma bonificação. É o
 * caso comum de quem bonifica a mesma carteira mês após mês — sem isto, todo
 * mês recomeçava do zero.
 *
 * Só contrato recorrente, de propósito:
 *   - venda pontual é UMA entrega; copiá-la pro mês seguinte é exatamente o
 *     pagamento em dobro que o fechamento existe pra evitar;
 *   - avulso é combinado de uma vez só.
 *
 * E só o contrato que ainda vale no mês novo (ativo, devido na competência,
 * marcado como bonificável). Lançamento novo nasce como não pago.
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
  if (!agencyId) return NextResponse.json({ error: "Sessão sem empresa vinculada" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const month = String(body?.month ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "Competência inválida" }, { status: 400 });
  }

  const fechada = await prisma.bonusClosure.findUnique({
    where: { companyId_month: { companyId: agencyId, month } },
    select: { id: true },
  });
  if (fechada) {
    return NextResponse.json({ error: `A competência ${month} está encerrada.` }, { status: 423 });
  }

  const anterior = shiftMonth(month, -1);
  const [origem, jaNoMes] = await Promise.all([
    prisma.bonus.findMany({
      where: { companyId: agencyId, month: anterior, clientServiceId: { not: null } },
      include: {
        clientService: {
          select: {
            id: true, isRecurring: true, status: true, amountCents: true, billingCycle: true,
            renewsAt: true, startedAt: true, endedAt: true, bonusEligible: true,
          },
        },
      },
    }),
    prisma.bonus.findMany({
      where: { companyId: agencyId, month, clientServiceId: { not: null } },
      select: { clientServiceId: true, userId: true, name: true },
    }),
  ]);

  // Mesma trava anti-duplicidade da API de lançamento: (contrato, colaborador).
  const chave = (cs: string | null, userId: string | null, name: string) =>
    `${cs}:${userId ?? `n:${name}`}`;
  const existentes = new Set(jaNoMes.map((b) => chave(b.clientServiceId, b.userId, b.name)));

  const copiar: {
    companyId: string; month: string; clientServiceId: string; userId: string | null;
    name: string; serviceValueCents: number; amountCents: number; notes: string | null;
  }[] = [];
  let jaExistia = 0;
  let foraDoMes = 0;

  for (const b of origem) {
    const cs = b.clientService;
    if (!cs) continue;
    if (existentes.has(chave(b.clientServiceId, b.userId, b.name))) { jaExistia++; continue; }
    // Contrato que encerrou, deixou de bonificar ou não vence nesta
    // competência (trimestral/anual) não ganha lançamento novo.
    if (!cs.bonusEligible || !dueInMonth(cs, month)) { foraDoMes++; continue; }
    copiar.push({
      companyId: agencyId,
      month,
      clientServiceId: cs.id,
      userId: b.userId,
      name: b.name,
      serviceValueCents: b.serviceValueCents,
      amountCents: b.amountCents,
      notes: b.notes,
    });
    existentes.add(chave(b.clientServiceId, b.userId, b.name));
  }

  if (copiar.length > 0) await prisma.bonus.createMany({ data: copiar });

  return NextResponse.json({
    copiados: copiar.length,
    jaExistia,
    foraDoMes,
    totalCents: copiar.reduce((n, c) => n + c.amountCents, 0),
  });
}
