import { BadgeType, ScoreReason } from "@/generated/prisma";
import { BADGE_META, BADGE_TIERS, TIER_STYLES, getBadgeProgress } from "./labels";

type Props = {
  // Contagem de eventos positivos por reason (vem da page server-side)
  counts: Partial<Record<ScoreReason, number>>;
  // Quantas vezes o usuário foi rei do mês (especial — vem de UserBadge.count)
  reiDoMesCount: number;
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
  SPRINT_MASTER:   null, // futuro — sem implementação ainda
  REI_DO_MES:      null, // calculado por UserBadge, não por ScoreEvent
};

const ALL_BADGES: BadgeType[] = [
  "RAIO_VELOZ", "RESOLVEDOR", "ANTECIPADOR", "CLOSER",
  "PRIMEIRO_DO_DIA", "ZERO_PENDENCIA", "FUNIL_COMPLETO",
  "SPRINT_MASTER", "REI_DO_MES",
];

export default function BadgesGrid({ counts, reiDoMesCount }: Props) {
  // Calcula o tier conquistado de cada badge para o resumo do header
  let unlockedCount = 0;
  for (const badge of ALL_BADGES) {
    const reason = BADGE_REASON[badge];
    const cnt    = badge === "REI_DO_MES" ? reiDoMesCount
                 : reason ? (counts[reason] ?? 0) : 0;
    const { currentTier } = getBadgeProgress(badge, cnt);
    if (currentTier) unlockedCount++;
  }

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

      <div className="space-y-2.5">
        {ALL_BADGES.map((badge) => {
          const meta   = BADGE_META[badge];
          const reason = BADGE_REASON[badge];
          const count  = badge === "REI_DO_MES"
            ? reiDoMesCount
            : reason ? (counts[reason] ?? 0) : 0;

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
                {/* Emoji */}
                <div className={`text-3xl flex-shrink-0 ${earned ? "" : "grayscale"}`}>
                  {meta.emoji}
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
                  </div>

                  {/* Progresso */}
                  {!isMax ? (
                    <div className="mt-1.5">
                      <div className="h-1.5 bg-[#080b12] rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            earned
                              ? "bg-gradient-to-r from-fuchsia-500 to-purple-500"
                              : "bg-gradient-to-r from-slate-600 to-slate-500"
                          }`}
                          style={{ width: `${progress * 100}%` }}
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
                      <div className="h-1.5 bg-gradient-to-r from-fuchsia-500 via-purple-500 to-blue-500 rounded-full" />
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
}
