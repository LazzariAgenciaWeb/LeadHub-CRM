import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getRanking } from "@/lib/gamification";
import { ScoreReason, BadgeType } from "@/generated/prisma";
import MyProfileCard from "./MyProfileCard";
import Leaderboard from "./Leaderboard";
import BadgesGrid from "./BadgesGrid";
import RecentEvents from "./RecentEvents";
import ImpersonationViewSwitcher from "./ImpersonationViewSwitcher";

// Sem cache — toda visita lê os dados atuais (pontos, badges e feed atualizam
// imediatamente após qualquer ação do usuário em outras páginas).
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function GamificacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ asUser?: string }>;
}) {
  const session = await getEffectiveSession();
  if (!session) return null;

  const sessionUserId = (session.user as any).id        as string;
  const sessionName   = (session.user as any).name      as string;
  const companyId     = (session.user as any).companyId as string | undefined;
  const isImpersonating = !!(session as any)._impersonating;

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

  // Quando impersonando, o painel pessoal mostra o top user da empresa por
  // padrão (ou o usuário escolhido via ?asUser=). Quando não impersonando,
  // sempre mostra a pontuação do próprio super_admin/usuário logado.
  const sp = await searchParams;
  const ranking = await getRanking(companyId, month, year);

  let viewUserId   = sessionUserId;
  let viewUserName = sessionName;
  let viewedFromImpersonation = false;

  if (isImpersonating) {
    const requested = sp.asUser ? ranking.find((r) => r.userId === sp.asUser) : null;
    const target    = requested ?? ranking[0]; // fallback: top user da empresa
    if (target) {
      viewUserId   = target.userId;
      viewUserName = target.name;
      viewedFromImpersonation = true;
    }
  }

  // Busca paralela (já com viewUserId resolvido)
  const [myScore, myBadges, myEvents, eventCounts, reiDoMesCount] = await Promise.all([
    prisma.userScore.findUnique({
      where: { userId_month_year: { userId: viewUserId, month, year } },
    }),
    prisma.userBadge.findMany({
      where:   { userId: viewUserId, companyId },
      orderBy: { earnedAt: "desc" },
    }),
    prisma.scoreEvent.findMany({
      where:   { userId: viewUserId, companyId },
      orderBy: { createdAt: "desc" },
      take:    30,
    }),
    prisma.scoreEvent.groupBy({
      by:      ["reason"],
      where:   { userId: viewUserId, companyId, points: { gt: 0 } },
      _count:  true,
    }),
    prisma.userBadge.count({
      where: { userId: viewUserId, companyId, badge: BadgeType.REI_DO_MES },
    }),
  ]);

  const counts: Partial<Record<ScoreReason, number>> = {};
  for (const row of eventCounts) counts[row.reason] = row._count;

  const myPosition  = ranking.findIndex((r) => r.userId === viewUserId) + 1 || null;
  const monthName   = now.toLocaleString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-white font-bold text-2xl">Painel de Performance</h1>
        <p className="text-slate-500 text-sm mt-1 capitalize">{monthName}</p>
      </div>

      {/* Banner de impersonação */}
      {viewedFromImpersonation && (
        <ImpersonationViewSwitcher
          currentUserId={viewUserId}
          users={ranking.map((r) => ({ id: r.userId, name: r.name, points: r.monthPoints }))}
        />
      )}

      {/* Layout 2 colunas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Coluna principal */}
        <div className="lg:col-span-2 space-y-5">
          <MyProfileCard
            userName={viewUserName}
            monthPoints={myScore?.monthPoints ?? 0}
            totalPoints={myScore?.totalPoints ?? 0}
            position={myPosition}
            totalUsers={ranking.length}
            badgeCount={myBadges.length}
          />

          <Leaderboard ranking={ranking} currentUserId={viewUserId} />
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
