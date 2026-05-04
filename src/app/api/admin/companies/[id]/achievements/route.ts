import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/admin/companies/[id]/achievements
// Retorna ranking + badges de cada usuário da empresa.
// Acesso: SUPER_ADMIN sempre; ADMIN somente da própria empresa.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any)?.role as string;
  const userCompanyId = (session.user as any)?.companyId as string | undefined;

  const { id: companyId } = await params;

  if (role !== "SUPER_ADMIN" && companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const now = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();

  const [users, allBadges] = await Promise.all([
    prisma.user.findMany({
      // Exclui SUPER_ADMIN: ações de super admin impersonando o cliente nao
      // devem aparecer como conquistas da empresa.
      where:  { companyId, role: { not: "SUPER_ADMIN" } },
      select: {
        id:   true,
        name: true,
        userScores: {
          where:  { month, year },
          select: { totalPoints: true, monthPoints: true },
          take:   1,
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.userBadge.findMany({
      where:  {
        companyId,
        user: { role: { not: "SUPER_ADMIN" } },
      },
      select: { userId: true, badge: true, tier: true, earnedAt: true },
    }),
  ]);

  const badgesByUser = new Map<string, typeof allBadges>();
  for (const b of allBadges) {
    const arr = badgesByUser.get(b.userId) ?? [];
    arr.push(b);
    badgesByUser.set(b.userId, arr);
  }

  // Pontuação total histórica = soma de todos UserScore.totalPoints (todos os meses).
  // Como só pegamos do mês atual acima, busca o agregado vitalício separado.
  const lifetime = await prisma.userScore.groupBy({
    by:     ["userId"],
    where:  { companyId },
    _max:   { totalPoints: true },
  });
  const lifetimeByUser = new Map<string, number>();
  for (const row of lifetime) lifetimeByUser.set(row.userId, row._max.totalPoints ?? 0);

  const result = users.map((u) => {
    const monthScore = u.userScores[0];
    return {
      userId:      u.id,
      name:        u.name,
      monthPoints: monthScore?.monthPoints ?? 0,
      totalPoints: lifetimeByUser.get(u.id) ?? monthScore?.totalPoints ?? 0,
      badges:      (badgesByUser.get(u.id) ?? []).map((b) => ({
        badge:   b.badge,
        tier:    b.tier,
        earnedAt: b.earnedAt.toISOString(),
      })),
    };
  });

  return NextResponse.json({ users: result, month, year });
}
