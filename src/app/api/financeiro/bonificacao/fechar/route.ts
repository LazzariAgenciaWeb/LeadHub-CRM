import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";

/**
 * Encerrar / reabrir a bonificação de uma competência.
 *
 * POST   { month } → encerra: o mês vira somente leitura (sem lançamento novo,
 *                    edição de valor nem exclusão). Dar baixa continua livre —
 *                    o pagamento costuma sair depois do fechamento.
 * DELETE ?month=   → reabre. Só ADMIN: reabrir é desfazer uma conferência, e
 *                    não deve estar na mão de quem só opera o financeiro.
 */
async function autorizar() {
  const session = await getEffectiveSession();
  if (!session) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const role = (session.user as any)?.role as string;
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  if (!isAdmin && !can(session, "canViewFinanceiro")) {
    return { erro: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  const agencyId = (session.user as any)?.companyId as string | undefined;
  if (!agencyId) {
    return { erro: NextResponse.json({ error: "Sessão sem empresa vinculada" }, { status: 400 }) };
  }
  const nome = (session.user as any)?.name ?? (session.user as any)?.email ?? null;
  return { agencyId, isAdmin, nome };
}

export async function POST(req: NextRequest) {
  const auth = await autorizar();
  if ("erro" in auth) return auth.erro;

  const body = await req.json().catch(() => ({}));
  const month = String(body?.month ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "Competência inválida" }, { status: 400 });
  }

  // Retrato do que está sendo fechado — guardado pra conferência posterior.
  const agg = await prisma.bonus.aggregate({
    where: { companyId: auth.agencyId, month },
    _sum: { amountCents: true },
    _count: true,
  });

  const fechamento = await prisma.bonusClosure.upsert({
    where: { companyId_month: { companyId: auth.agencyId, month } },
    create: {
      companyId: auth.agencyId,
      month,
      totalCents: agg._sum.amountCents ?? 0,
      qtd: agg._count,
      closedBy: auth.nome,
    },
    // Reencerrar depois de reabrir atualiza o retrato e o autor.
    update: {
      totalCents: agg._sum.amountCents ?? 0,
      qtd: agg._count,
      closedAt: new Date(),
      closedBy: auth.nome,
    },
  });

  return NextResponse.json(fechamento, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await autorizar();
  if ("erro" in auth) return auth.erro;
  if (!auth.isAdmin) {
    return NextResponse.json({ error: "Só administrador reabre uma competência encerrada." }, { status: 403 });
  }

  const month = req.nextUrl.searchParams.get("month") ?? "";
  const atual = await prisma.bonusClosure.findUnique({
    where: { companyId_month: { companyId: auth.agencyId, month } },
  });
  if (!atual) return NextResponse.json({ ok: true });

  // Reabrir apaga o registro (o mês volta a ser editável), mas antes deixa
  // rastro no log do financeiro — vai-e-vem de fechamento é o que se quer
  // conseguir explicar depois.
  await prisma.financeLog
    .create({
      data: {
        companyId: auth.agencyId,
        entity: "BONIFICACAO",
        entityId: atual.id,
        action: "REABERTO",
        description: `Competência ${month} reaberta`,
        meta: {
          competencia: month,
          fechadaEm: atual.closedAt.toISOString(),
          fechadaPor: atual.closedBy,
          totalNoFechamento: atual.totalCents,
          qtdNoFechamento: atual.qtd,
        },
        userName: auth.nome,
      },
    })
    .catch((e) => console.error("[finance-log reabrir bonificacao]", e));

  await prisma.bonusClosure.delete({ where: { id: atual.id } });
  return NextResponse.json({ ok: true });
}
