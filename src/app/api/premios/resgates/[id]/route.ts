import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { RedemptionStatus } from "@/generated/prisma";
import { assertModule } from "@/lib/billing";

// PATCH /api/premios/resgates/[id] — admin aprova/rejeita/entrega
// Body: { status: "APPROVED"|"REJECTED"|"DELIVERED", notes? }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "gamificacao");
  if (!gate.ok) return gate.response;

  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { id } = await params;
  const redemption = await prisma.rewardRedemption.findUnique({
    where:   { id },
    include: { reward: true },
  });
  if (!redemption) return NextResponse.json({ error: "Resgate não encontrado" }, { status: 404 });
  if (role === "ADMIN" && redemption.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { status, notes } = await req.json();
  if (!["APPROVED", "REJECTED", "DELIVERED"].includes(status)) {
    return NextResponse.json({ error: "status inválido" }, { status: 400 });
  }

  // Se REJECTED, devolve os pontos e o estoque
  if (status === "REJECTED" && redemption.status === "PENDING") {
    const latestScore = await prisma.userScore.findFirst({
      where:   { userId: redemption.userId, companyId: redemption.companyId },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    if (latestScore) {
      await prisma.userScore.update({
        where: { id: latestScore.id },
        data:  { redeemablePoints: { increment: redemption.cost } },
      });
    }
    if (redemption.reward.stock !== null) {
      await prisma.reward.update({
        where: { id: redemption.rewardId },
        data:  { stock: { increment: 1 } },
      });
    }
  }

  const updated = await prisma.rewardRedemption.update({
    where: { id },
    data: {
      status:     status as RedemptionStatus,
      notes:      notes ?? redemption.notes,
      resolvedAt: status === "DELIVERED" || status === "REJECTED" ? new Date() : redemption.resolvedAt,
    },
  });
  return NextResponse.json(updated);
}
