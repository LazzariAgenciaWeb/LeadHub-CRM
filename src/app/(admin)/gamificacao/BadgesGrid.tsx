import { BadgeType, ScoreReason } from "@/generated/prisma";
import {
  BADGE_META, BADGE_TIERS, TIER_STYLES, REASON_LABEL,
  BADGE_CATEGORY, CATEGORY_META, CATEGORY_ORDER,
  BAR_GRADIENT, ICON_GLOW,
  getBadgeProgress,
} from "./labels";
import BadgeInfoButton from "./BadgeInfoButton";

type Props = {
  // Contagem de eventos positivos por reason (vem da page server-side)
  counts: Partial<Record<ScoreReason, number>>;
  // Quantas vezes o usuário foi rei do mês (especial — vem de UserBadge.count)
  reiDoMesCount: number;
  // Tiers já conquistados (UserBadge) — usado como piso de progresso pra
  // tolerar inconsistências entre ScoreEvent e UserBadge.
  earnedBadges: { badge: BadgeType; tier: number }[];
};

// Mapeia BadgeType → ScoreReason que conta para o progresso
const BADGE_REASON: Record<BadgeType, ScoreReason | null> = {
  RAIO_VELOZ:      "RESPOSTA_RAPIDA_5MIN",
  RESOLVEDOR:      "TICKET_RESOLVIDO",
  CLOSER:          "LEAD_CONVERTIDO",
  ANTECIPADOR:     "RETORNO_ANTECIPADO",
  PRIMEIRO_DO_DIA: "ATENDIMENTO_MESMO_DIA",
  ZERO_PENDENCIA:  "DIA_SEM_PENDENCIA",
  FUNIL_COMPLETO:  "LEAD_AVANCADO",
  PONTUAL:         "DIA_SEM_ATRASO",
  ENTREGADOR:      "PROJETO_ENTREGUE_NO_PRAZO",
  SPRINT_MASTER:   null, // futuro — sem implementação ainda
  REI_DO_MES:      null, // calculado por UserBadge, não por ScoreEvent
};

const ALL_BADGES: BadgeType[] = [
  "RAIO_VELOZ", "RESOLVEDOR", "ANTECIPADOR", "CLOSER",
  "PRIMEIRO_DO_DIA", "ZERO_PENDENCIA", "FUNIL_COMPLETO",
  "PONTUAL", "ENTREGADOR", "SPRINT_MASTER", "REI_DO_MES",
];

export default function BadgesGrid({ counts, reiDoMesCount, earnedBadges }: Props) {
  // Maior tier por badge a partir do que já está em UserBadge
  const maxTierByBadge = new Map<BadgeType, number>();
  for (const eb of earnedBadges) {
    const cur = maxTierByBadge.get(eb.badge) ?? 0;
    if (eb.tier > cur) maxTierByBadge.set(eb.badge, eb.tier);
  }

  /** Conta efetiva do badge: máx entre eventos atuais e o threshold do tier
   *  já conquistado (garante que badges existentes não apareçam como locked). */
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

  // Calcula o tier conquistado de cada badge para o resumo do header
  let unlockedCount = 0;
  for (const badge of ALL_BADGES) {
    const { currentTier } = getBadgeProgress(badge, effectiveCount(badge));
    if (currentTier) unlockedCount++;
  }

  // Agrupa badges por categoria preservando a ordem CATEGORY_ORDER
  const byCategory = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    badges: ALL_BADGES.filter((b) => BADGE_CATEGORY[b] === cat),
  })).filter((g) => g.badges.length > 0);

  return (
    <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-white font-semibold text-sm">🎖️ Conquistas</h3>
          <p className="text-slate-500 text-xs mt-0.5">
            {unlockedCount} de {ALL_BADGES.length} desbloqueadas — 6 níveis cada
          </p>
        </div>
      </div>

      <div className="space-y-5">
        {byCategory.map((group) => {
          const meta = CATEGORY_META[group.category];
          const earnedInCat = group.badges.filter((b) => {
            const { currentTier } = getBadgeProgress(b, effectiveCount(b));
            return !!currentTier;
          }).length;

          return (
            <div key={group.category}>
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{meta.emoji}</span>
                  <span className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                    {meta.label}
                  </span>
                </div>
                <span className="text-slate-600 text-[10px]">
                  {earnedInCat}/{group.badges.length}
                </span>
              </div>

              <div className="space-y-2">
                {group.badges.map((badge) => {
          const meta  = BADGE_META[badge];
          const count = effectiveCount(badge);

          const { currentTier, nextTier, progress } = getBadgeProgress(badge, count);
          const tiers   = BADGE_TIERS[badge];
          const style   = currentTier ? TIER_STYLES[currentTier.level] : null;
          const earned  = !!currentTier;
          const isMax   = !nextTier;

          return (
            <div
              key={badge}
              className={`relative rounded-xl border transition-all overflow-hidden ${
                earned
                  ? `${style!.bg} border-transparent ring-1 ${style!.ring}`
                  : "bg-[#080b12] border-[#1e2d45] opacity-60"
              }`}
            >
              {/* Borda especial para Highlander */}
              {currentTier?.level === 6 && (
                <div className="absolute inset-0 rounded-xl pointer-events-none ring-2 ring-fuchsia-400/30 animate-pulse" />
              )}

              <div className="p-3 flex items-center gap-3">
                {/* Emoji em círculo "termômetro" — bg + ring + glow esquentam por tier */}
                <div className={`relative w-12 h-12 rounded-full flex items-center justify-center text-2xl flex-shrink-0 transition-all ${
                  ICON_GLOW[currentTier?.level ?? 0]
                } ${currentTier?.level === 6 ? "animate-pulse" : ""}`}>
                  <span className={earned ? "" : "grayscale opacity-60"}>{meta.emoji}</span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-xs font-semibold ${earned ? "text-white" : "text-slate-500"}`}>
                      {meta.name}
                    </span>
                    {currentTier ? (
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${style!.badgeBg} ${style!.badgeText}`}>
                        N{currentTier.level} · {currentTier.name}
                      </span>
                    ) : (
                      <span className="text-[9px] uppercase tracking-wider text-slate-700">
                        Bloqueado
                      </span>
                    )}
                    <div className="ml-auto">
                      <BadgeInfoButton
                        badge={badge}
                        count={count}
                        currentTier={currentTier?.level ?? null}
                        reasonText={BADGE_REASON[badge] ? REASON_LABEL[BADGE_REASON[badge]!].text : undefined}
                      />
                    </div>
                  </div>

                  {/* Progresso — barra termômetro com gradiente do tier atual ao próximo */}
                  {!isMax ? (
                    <div className="mt-1.5">
                      <div className="h-2 bg-[#080b12] rounded-full overflow-hidden border border-[#1e2d45]">
                        <div
                          className={`h-full transition-all duration-500 ${BAR_GRADIENT[currentTier?.level ?? 0]}`}
                          style={{ width: `${Math.max(2, progress * 100)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-slate-600 text-[10px]">
                          {count} / {nextTier!.threshold}
                        </span>
                        <span className="text-slate-500 text-[10px]">
                          → <span className="text-slate-400 font-medium">{nextTier!.name}</span>
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1.5">
                      <div className="h-2 bg-gradient-to-r from-fuchsia-500 via-purple-500 to-pink-400 rounded-full animate-pulse" />
                      <div className="text-fuchsia-300 text-[10px] mt-1 font-semibold">
                        ✦ Nível máximo · {count} eventos
                      </div>
                    </div>
                  )}

                  {/* Lista de tiers (mini) */}
                  <div className="flex gap-0.5 mt-2">
                    {tiers.map((t) => {
                      const unlocked = currentTier && t.level <= currentTier.level;
                      const tStyle = TIER_STYLES[t.level];
                      return (
                        <div
                          key={t.level}
                          title={`N${t.level} · ${t.name} (${t.threshold} eventos)`}
                          className={`flex-1 h-1 rounded-full ${
                            unlocked ? tStyle.badgeBg : "bg-[#1e2d45]"
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
