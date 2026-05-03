import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getRanking } from "@/lib/gamification";
import { ScoreReason, BadgeType } from "@/generated/prisma";
import MyProfileCard from "./MyProfileCard";
import Leaderboard from "./Leaderboard";
import BadgesGrid from "./BadgesGrid";
import RecentEvents from "./RecentEvents";

export default async function GamificacaoPage() {
  const session = await getEffectiveSession();
  if (!session) return null;

  const userId    = (session.user as any).id        as string;
  const userName  = (session.user as any).name      as string;
  const companyId = (session.user as any).companyId as string | undefined;

  if (!companyId) {
    return (
      <div className="p-6">
        <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl p-8 text-center">
          <p className="text-slate-500 text-sm">
            Você precisa estar vinculado a uma empresa para acessar a gamificação.
          </p>
        </div>
      </div>
    );
  }

  const now   = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();

  // Busca paralela
  const [ranking, myScore, myBadges, myEvents, eventCounts, reiDoMesCount] = await Promise.all([
    getRanking(companyId, month, year),
    prisma.userScore.findUnique({
      where: { userId_month_year: { userId, month, year } },
    }),
    prisma.userBadge.findMany({
      where:   { userId, companyId },
      orderBy: { earnedAt: "desc" },
    }),
    prisma.scoreEvent.findMany({
      where:   { userId, companyId },
      orderBy: { createdAt: "desc" },
      take:    30,
    }),
    // Contagem de eventos positivos por reason — alimenta o progresso dos badges
    prisma.scoreEvent.groupBy({
      by:      ["reason"],
      where:   { userId, companyId, points: { gt: 0 } },
      _count:  true,
    }),
    prisma.userBadge.count({
      where: { userId, companyId, badge: BadgeType.REI_DO_MES },
    }),
  ]);

  const counts: Partial<Record<ScoreReason, number>> = {};
  for (const row of eventCounts) counts[row.reason] = row._count;

  const myPosition  = ranking.findIndex((r) => r.userId === userId) + 1 || null;
  const monthName   = now.toLocaleString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-white font-bold text-2xl">Painel de Performance</h1>
        <p className="text-slate-500 text-sm mt-1 capitalize">{monthName}</p>
      </div>

      {/* Layout 2 colunas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Coluna principal */}
        <div className="lg:col-span-2 space-y-5">
          <MyProfileCard
            userName={userName}
            monthPoints={myScore?.monthPoints ?? 0}
            totalPoints={myScore?.totalPoints ?? 0}
            position={myPosition}
            totalUsers={ranking.length}
            badgeCount={myBadges.length}
          />

          <Leaderboard ranking={ranking} currentUserId={userId} />
        </div>

        {/* Coluna lateral */}
        <div className="space-y-5">
          <BadgesGrid
            counts={counts}
            reiDoMesCount={reiDoMesCount}
            earnedBadges={myBadges.map((b) => ({ badge: b.badge, tier: b.tier }))}
          />
          <RecentEvents events={myEvents} />
        </div>
      </div>
    </div>
  );
}
