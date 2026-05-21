import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getRanking } from "@/lib/gamification";
import { ScoreReason, BadgeType } from "@/generated/prisma";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import BadgeMedallion from "../gamificacao/BadgeMedallion";
import { BADGE_TIERS, ALL_BADGES, BADGE_REASON, shouldShowBadge } from "../gamificacao/labels";
import LiveRankingMini from "./LiveRankingMini";

export default async function DashboardGamificacaoTop() {
  const session = await getEffectiveSession();
  if (!session) return null;

  const sessionUserId = (session.user as any).id        as string;
  const companyId     = (session.user as any).companyId as string | undefined;
  const role          = (session.user as any).role      as string;
  const isAdmin       = role === "ADMIN" || role === "SUPER_ADMIN";
  const isImpersonating = !!(session as any)._impersonating;
  const modules       = (session.user as any).modules as Record<string, boolean> | undefined;
  const gamificacaoEnabled = modules?.gamificacao ?? false;

  if (!companyId) return null;

  // Módulo não contratado → seção fica oculta aqui. O upsell agora vive
  // num grid unificado no rodapé do dashboard (<ModuleUpsell />) que cobre
  // gamificação + outros add-ons. Antes esse arquivo renderizava um card
  // lock-only — virou redundância e foi removido.
  if (!gamificacaoEnabled) return null;

  const now   = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();

  const ranking = await getRanking(companyId, month, year);

  // Quando impersonando, usa o top user da empresa pra ter dados pra mostrar.
  // Senão usa o user logado normalmente.
  const viewUserId = isImpersonating
    ? (ranking[0]?.userId ?? sessionUserId)
    : sessionUserId;

  // Carrega tudo em paralelo
  const [myScore, myBadges, eventCounts, reiDoMesCount] = await Promise.all([
    prisma.userScore.findUnique({
      where: { userId_month_year: { userId: viewUserId, month, year } },
    }),
    prisma.userBadge.findMany({
      where:  { userId: viewUserId, companyId },
      select: { badge: true, tier: true },
    }),
    prisma.scoreEvent.groupBy({
      by:     ["reason"],
      where:  { userId: viewUserId, companyId, points: { gt: 0 } },
      _count: true,
    }),
    prisma.userBadge.count({
      where: { userId: viewUserId, companyId, badge: BadgeType.REI_DO_MES },
    }),
  ]);

  const counts: Partial<Record<ScoreReason, number>> = {};
  for (const row of eventCounts) counts[row.reason] = row._count;

  // Maior tier por badge (piso de progresso)
  const maxTierByBadge = new Map<BadgeType, number>();
  for (const b of myBadges) {
    const cur = maxTierByBadge.get(b.badge) ?? 0;
    if (b.tier > cur) maxTierByBadge.set(b.badge, b.tier);
  }

  // Filtra easter eggs não conquistados pra não-admin
  const visibleBadges = ALL_BADGES.filter((b) => {
    const earned = (maxTierByBadge.get(b) ?? 0) > 0;
    return shouldShowBadge(b, isAdmin, earned);
  });
  function effectiveCount(badge: BadgeType): number {
    const reason = BADGE_REASON[badge];
    const fromEvents = badge === "REI_DO_MES" ? reiDoMesCount
                     : reason ? (counts[reason] ?? 0) : 0;
    const earnedTier = maxTierByBadge.get(badge) ?? 0;
    if (earnedTier === 0) return fromEvents;
    const tierThreshold = BADGE_TIERS[badge][earnedTier - 1].threshold;
    return Math.max(fromEvents, tierThreshold);
  }

  // Apenas pra label "Conquistas do top da empresa · {nome}" no banner de
  // impersonação — ranking real fica no LiveRankingMini (auto-refresh 30s).
  const me = ranking.find((r) => r.userId === viewUserId);

  const monthPoints = myScore?.monthPoints ?? 0;
  const distinctEarned = new Set(myBadges.map((b) => b.badge)).size;

  // Esconde só se realmente não tem nada pra mostrar
  if (monthPoints === 0 && distinctEarned === 0 && ranking.length === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Medalhões — coluna principal */}
      <div className="lg:col-span-2 bg-gradient-to-br from-[#0a0f1a] to-[#0f1623] border border-[#1e2d45] rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-white font-semibold text-sm flex items-center gap-2">
              🎖️ {isImpersonating ? "Conquistas do top da empresa" : "Suas conquistas"}
            </h3>
            <p className="text-slate-500 text-xs mt-0.5">
              {distinctEarned} de {visibleBadges.length} desbloqueadas · {monthPoints} pts no mês
              {isAdmin && <span className="text-fuchsia-400/70"> · 🥚 vê easter eggs</span>}
              {isImpersonating && me && <span className="text-amber-400/80"> · {me.name}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/gamificacao/regras"
              className="text-[10px] text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-white/5 transition-colors"
              title="Tabela de pontos: como cada ação vira ponto"
            >
              📖 Tabela
            </Link>
            <Link
              href="/gamificacao"
              className="text-xs text-yellow-300/70 hover:text-yellow-300 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-yellow-500/10 transition-colors"
            >
              Ver painel <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-5 sm:grid-cols-7 gap-2">
          {visibleBadges.map((badge) => (
            <BadgeMedallion key={badge} badge={badge} count={effectiveCount(badge)} size={56} />
          ))}
        </div>
      </div>

      {/* Mini Ranking — coluna lateral (auto-refresh 30s) */}
      <LiveRankingMini
        initialRanking={ranking.map((r) => ({
          userId:          r.userId,
          name:            r.name,
          rankingCategory: r.rankingCategory,
          monthPoints:     r.monthPoints,
        }))}
        viewUserId={viewUserId}
      />
    </div>
  );
}

