import { NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getRanking } from "@/lib/gamification";

// GET /api/gamificacao/meu-perfil
// Retorna pontuação, posição no ranking e badges do usuário logado.
export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId    = (session.user as any).id as string;
  const companyId = (session.user as any).companyId as string | undefined;

  if (!companyId) {
    return NextResponse.json({ error: "Empresa não encontrada" }, { status: 400 });
  }

  const now   = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();

  const [score, badges, recentEvents, ranking] = await Promise.all([
    prisma.userScore.findUnique({
      where: { userId_month_year: { userId, month, year } },
    }),
    prisma.userBadge.findMany({
      where:   { userId, companyId },
      orderBy: { earnedAt: "desc" },
    }),
    // últimos 20 eventos para o feed
    prisma.scoreEvent.findMany({
      where:   { userId, companyId },
      orderBy: { createdAt: "desc" },
      take:    20,
    }),
    getRanking(companyId, month, year),
  ]);

  const position = ranking.findIndex((r) => r.userId === userId) + 1;

  return NextResponse.json({
    monthPoints: score?.monthPoints ?? 0,
    totalPoints: score?.totalPoints ?? 0,
    position:    position || null,
    totalUsers:  ranking.length,
    badges,
    recentEvents,
  });
}
