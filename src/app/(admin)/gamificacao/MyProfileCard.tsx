import Link from "next/link";
import { Trophy, TrendingUp, Award, History, Gift } from "lucide-react";
import { gradStroke } from "@/components/IconGradients";
import { BadgeType, ScoreReason } from "@/generated/prisma";
import BadgeMedallion from "./BadgeMedallion";
import { shouldShowBadge, ALL_BADGES, BADGE_REASON, BADGE_TIERS } from "./labels";

type Props = {
  userName:    string;
  monthPoints: number;
  totalPoints: number;
  position:    number | null;
  totalUsers:  number;
  // Tiers já conquistados em UserBadge — usado como piso de progresso
  earnedBadges: { badge: BadgeType; tier: number }[];
  // Contagem de eventos positivos por reason — alimenta o progresso
  counts:        Partial<Record<ScoreReason, number>>;
  // REI_DO_MES (calculado por UserBadge.count)
  reiDoMesCount: number;
  // Se o user é admin — vê easter eggs sem desbloquear
  isAdmin?: boolean;
};

export default function MyProfileCard({
  userName, monthPoints, totalPoints, position, totalUsers,
  earnedBadges, counts, reiDoMesCount, isAdmin = false,
}: Props) {
  const positionLabel = position
    ? position === 1 ? "🥇 1º"
      : position === 2 ? "🥈 2º"
      : position === 3 ? "🥉 3º"
      : `${position}º`
    : "—";

  // Maior tier por badge a partir do que está em UserBadge
  const maxTierByBadge = new Map<BadgeType, number>();
  for (const eb of earnedBadges) {
    const cur = maxTierByBadge.get(eb.badge) ?? 0;
    if (eb.tier > cur) maxTierByBadge.set(eb.badge, eb.tier);
  }

  // Conta efetiva por badge (max entre eventos atuais e threshold do tier conquistado).
  // O piso pelo tier é necessário pra refletir badges concedidos manualmente
  // (admin via grant-badge) que não têm ScoreEvents acumulados.
  function effectiveCount(badge: BadgeType): number {
    const reason = BADGE_REASON[badge];
    const fromEvents = badge === "REI_DO_MES"
      ? reiDoMesCount
      : reason ? (counts[reason] ?? 0) : 0;
    const earnedTier = maxTierByBadge.get(badge) ?? 0;
    if (earnedTier === 0) return fromEvents;
    const tierThreshold = BADGE_TIERS[badge][earnedTier - 1].threshold;
    return Math.max(fromEvents, tierThreshold);
  }

  const distinctEarned = new Set(earnedBadges.map((b) => b.badge)).size;

  // Filtra easter eggs não conquistados pra não-admin
  const earnedSet = new Set(earnedBadges.map((b) => b.badge));
  const visibleBadges = ALL_BADGES.filter((b) => shouldShowBadge(b, isAdmin, earnedSet.has(b)));

  return (
    <div className="bg-gradient-to-br from-[#0a0f1a] to-[#0f1623] border border-[#1e2d45] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Olá,</p>
          <h2 className="text-white font-semibold text-xl">{userName}</h2>
          <p className="text-slate-500 text-xs mt-1">Seu desempenho no mês</p>
        </div>
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-500/20 to-orange-500/10 border border-yellow-500/30 flex items-center justify-center">
          <Trophy className="w-6 h-6" stroke={gradStroke("gamificacao")} strokeWidth={2} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[#080b12] border border-[#1e2d45] rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <p className="text-slate-500 text-[10px] uppercase tracking-wider">Mês</p>
          </div>
          <p className="text-white font-bold text-2xl">{monthPoints}</p>
          <p className="text-slate-600 text-[11px] mt-0.5">pontos</p>
        </div>
        <div className="bg-[#080b12] border border-[#1e2d45] rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Trophy className="w-3.5 h-3.5 text-yellow-400" />
            <p className="text-slate-500 text-[10px] uppercase tracking-wider">Posição</p>
          </div>
          <p className="text-white font-bold text-2xl">{positionLabel}</p>
          <p className="text-slate-600 text-[11px] mt-0.5">de {totalUsers}</p>
        </div>
        <div className="bg-[#080b12] border border-[#1e2d45] rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Award className="w-3.5 h-3.5 text-indigo-400" />
            <p className="text-slate-500 text-[10px] uppercase tracking-wider">Badges</p>
          </div>
          <p className="text-white font-bold text-2xl">{distinctEarned}</p>
          <p className="text-slate-600 text-[11px] mt-0.5">conquistadas</p>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-[#1e2d45] flex items-center justify-between text-xs gap-2">
        <Link
          href="/gamificacao/historico"
          className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors"
        >
          <History className="w-3 h-3" /> {totalPoints} pts no histórico
        </Link>
        <Link
          href="/gamificacao/premios"
          className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 transition-colors"
        >
          <Gift className="w-3 h-3" /> Trocar por prêmios
        </Link>
      </div>

      {/* Medalhões — barra termômetro circular por badge */}
      <div className="mt-5 pt-5 border-t border-[#1e2d45]">
        <p className="text-slate-500 text-[10px] uppercase tracking-wider mb-3">
          Suas conquistas — termômetro de progresso
        </p>
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
          {visibleBadges.map((badge) => (
            <BadgeMedallion
              key={badge}
              badge={badge}
              count={effectiveCount(badge)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
