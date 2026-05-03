import { Trophy, TrendingUp, Award } from "lucide-react";
import { gradStroke } from "@/components/IconGradients";
import { BadgeType } from "@/generated/prisma";
import { BADGE_META, BADGE_TIERS, TIER_STYLES } from "./labels";

type Props = {
  userName:    string;
  monthPoints: number;
  totalPoints: number;
  position:    number | null;
  totalUsers:  number;
  // Maior tier conquistado por badge
  earnedBadges: { badge: BadgeType; tier: number }[];
};

export default function MyProfileCard({
  userName, monthPoints, totalPoints, position, totalUsers, earnedBadges,
}: Props) {
  const positionLabel = position
    ? position === 1 ? "🥇 1º"
      : position === 2 ? "🥈 2º"
      : position === 3 ? "🥉 3º"
      : `${position}º`
    : "—";

  // Reduz pra um item por badge — mostra só o maior tier conquistado
  const highestByType = new Map<BadgeType, number>();
  for (const b of earnedBadges) {
    const cur = highestByType.get(b.badge) ?? 0;
    if (b.tier > cur) highestByType.set(b.badge, b.tier);
  }
  const distinctBadges = Array.from(highestByType.entries())
    .map(([badge, tier]) => ({ badge, tier }))
    .sort((a, b) => b.tier - a.tier);

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
        {/* Pontos do mês */}
        <div className="bg-[#080b12] border border-[#1e2d45] rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <p className="text-slate-500 text-[10px] uppercase tracking-wider">Mês</p>
          </div>
          <p className="text-white font-bold text-2xl">{monthPoints}</p>
          <p className="text-slate-600 text-[11px] mt-0.5">pontos</p>
        </div>

        {/* Posição */}
        <div className="bg-[#080b12] border border-[#1e2d45] rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Trophy className="w-3.5 h-3.5 text-yellow-400" />
            <p className="text-slate-500 text-[10px] uppercase tracking-wider">Posição</p>
          </div>
          <p className="text-white font-bold text-2xl">{positionLabel}</p>
          <p className="text-slate-600 text-[11px] mt-0.5">de {totalUsers}</p>
        </div>

        {/* Badges */}
        <div className="bg-[#080b12] border border-[#1e2d45] rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Award className="w-3.5 h-3.5 text-indigo-400" />
            <p className="text-slate-500 text-[10px] uppercase tracking-wider">Badges</p>
          </div>
          <p className="text-white font-bold text-2xl">{distinctBadges.length}</p>
          <p className="text-slate-600 text-[11px] mt-0.5">conquistadas</p>
        </div>
      </div>

      {/* Lista de badges conquistadas */}
      {distinctBadges.length > 0 && (
        <div className="mt-4 pt-4 border-t border-[#1e2d45]">
          <p className="text-slate-500 text-[10px] uppercase tracking-wider mb-2">Suas conquistas</p>
          <div className="flex flex-wrap gap-1.5">
            {distinctBadges.map(({ badge, tier }) => {
              const meta  = BADGE_META[badge];
              const tName = BADGE_TIERS[badge].find((t) => t.level === tier)?.name ?? "";
              const style = TIER_STYLES[tier];
              return (
                <div
                  key={badge}
                  title={`${meta.name} · N${tier} ${tName}`}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${style.bg} ring-1 ${style.ring}`}
                >
                  <span className="text-base leading-none">{meta.emoji}</span>
                  <div className="flex flex-col leading-tight">
                    <span className="text-white text-[11px] font-semibold">{meta.name}</span>
                    <span className={`text-[9px] font-bold uppercase tracking-wider ${style.text}`}>
                      N{tier} · {tName}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-[#1e2d45] flex items-center justify-between text-xs">
        <span className="text-slate-500">Acumulado total</span>
        <span className="text-white font-medium">{totalPoints} pts</span>
      </div>
    </div>
  );
}
