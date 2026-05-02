import { BadgeType, BadgeLevel } from "@/generated/prisma";
import { BADGE_META, LEVEL_META } from "./labels";

type Props = {
  earned: { badge: BadgeType; level: BadgeLevel; earnedAt: Date }[];
};

const ALL_BADGES: BadgeType[] = [
  "RAIO_VELOZ", "RESOLVEDOR", "ANTECIPADOR", "CLOSER",
  "PRIMEIRO_DO_DIA", "ZERO_PENDENCIA", "FUNIL_COMPLETO",
  "SPRINT_MASTER", "REI_DO_MES",
];

const LEVEL_ORDER: BadgeLevel[] = ["OURO", "PRATA", "BRONZE"];

export default function BadgesGrid({ earned }: Props) {
  // Para cada tipo de badge, pega o nível mais alto conquistado
  const highestByType = new Map<BadgeType, BadgeLevel>();
  for (const e of earned) {
    const current = highestByType.get(e.badge);
    if (!current || LEVEL_ORDER.indexOf(e.level) < LEVEL_ORDER.indexOf(current)) {
      highestByType.set(e.badge, e.level);
    }
  }

  return (
    <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-white font-semibold text-sm">🎖️ Conquistas</h3>
          <p className="text-slate-500 text-xs mt-0.5">
            {highestByType.size} de {ALL_BADGES.length} desbloqueadas
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {ALL_BADGES.map((type) => {
          const meta  = BADGE_META[type];
          const level = highestByType.get(type);
          const lvl   = level ? LEVEL_META[level] : null;
          const earned = !!level;

          return (
            <div
              key={type}
              title={meta.description}
              className={`relative rounded-xl border p-3 transition-all ${
                earned
                  ? `${lvl!.bg} border-transparent ring-1 ${lvl!.ring}`
                  : "bg-[#080b12] border-[#1e2d45] opacity-50"
              }`}
            >
              <div className="text-center">
                <div className={`text-3xl mb-1.5 ${earned ? "" : "grayscale"}`}>
                  {meta.emoji}
                </div>
                <div className={`text-[11px] font-semibold leading-tight ${earned ? "text-white" : "text-slate-500"}`}>
                  {meta.name}
                </div>
                {earned ? (
                  <div className={`text-[9px] mt-1 uppercase tracking-wider font-bold ${lvl!.text}`}>
                    {lvl!.name}
                  </div>
                ) : (
                  <div className="text-[9px] mt-1 text-slate-700 uppercase tracking-wider">
                    Bloqueado
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
