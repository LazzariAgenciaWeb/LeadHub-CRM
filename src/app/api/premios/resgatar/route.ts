import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";

// POST /api/premios/resgatar
// Body: { rewardId }
// Debita redeemablePoints e cria RewardRedemption pendente.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "gamificacao");
  if (!gate.ok) return gate.response;

  const userId    = (session.user as any).id as string;
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Empresa não encontrada" }, { status: 400 });

  const { rewardId } = await req.json();
  if (!rewardId) return NextResponse.json({ error: "rewardId obrigatório" }, { status: 400 });

  const reward = await prisma.reward.findUnique({ where: { id: rewardId } });
  if (!reward) return NextResponse.json({ error: "Prêmio não encontrado" }, { status: 404 });
  if (!reward.available) return NextResponse.json({ error: "Prêmio indisponível" }, { status: 400 });
  if (reward.companyId !== companyId) return NextResponse.json({ error: "Prêmio de outra empresa" }, { status: 403 });
  if (reward.stock !== null && reward.stock <= 0) {
    return NextResponse.json({ error: "Sem estoque" }, { status: 400 });
  }

  // Soma TODOS redeemablePoints do user (de todos os meses) — concentra a saldo
  const aggr = await prisma.userScore.aggregate({
    where:  { userId, companyId },
    _sum:   { redeemablePoints: true },
  });
  const totalRedeemable = aggr._sum.redeemablePoints ?? 0;
  if (totalRedeemable < reward.cost) {
    return NextResponse.json({
      error: `Saldo insuficiente: você tem ${totalRedeemable} pts, prêmio custa ${reward.cost}`,
    }, { status: 400 });
  }

  // Debita do mês mais recente. Se não cobrir, vai puxando dos anteriores.
  let toDebit = reward.cost;
  const scores = await prisma.userScore.findMany({
    where:   { userId, companyId, redeemablePoints: { gt: 0 } },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  for (const s of scores) {
    if (toDebit <= 0) break;
    const debit = Math.min(s.redeemablePoints, toDebit);
    await prisma.userScore.update({
      where: { id: s.id },
      data:  { redeemablePoints: { decrement: debit } },
    });
    toDebit -= debit;
  }

  // Cria a redemption (pending)
  const redemption = await prisma.rewardRedemption.create({
    data: {
      userId,
      companyId,
      rewardId,
      rewardName: reward.name,
      cost:       reward.cost,
      status:     "PENDING",
    },
  });

  // Decrementa estoque se aplicável
  if (reward.stock !== null) {
    await prisma.reward.update({
      where: { id: rewardId },
      data:  { stock: { decrement: 1 } },
    });
  }

  return NextResponse.json(redemption, { status: 201 });
}
