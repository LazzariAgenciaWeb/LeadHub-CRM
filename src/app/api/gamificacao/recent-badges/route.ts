import { NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// GET /api/gamificacao/recent-badges
// Retorna badges conquistados desde o último User.lastBadgeSeenAt e
// ATUALIZA o timestamp pra não retornar duas vezes.
//
// Cliente faz polling pra exibir toast.
export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ badges: [] });

  const userId = (session.user as any).id as string | undefined;
  if (!userId) return NextResponse.json({ badges: [] });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastBadgeSeenAt: true, companyId: true },
  });
  if (!user) return NextResponse.json({ badges: [] });

  const since = user.lastBadgeSeenAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

  const newBadges = await prisma.userBadge.findMany({
    where: {
      userId,
      earnedAt: { gt: since },
    },
    orderBy: { earnedAt: "desc" },
  });

  // Marca como visto (sempre — mesmo array vazio)
  await prisma.user.update({
    where: { id: userId },
    data:  { lastBadgeSeenAt: new Date() },
  });

  return NextResponse.json({ badges: newBadges });
}
