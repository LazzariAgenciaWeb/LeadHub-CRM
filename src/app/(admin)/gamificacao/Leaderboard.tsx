import { BadgeType } from "@/generated/prisma";
import { BADGE_META, BADGE_TIERS, TIER_STYLES } from "./labels";

type RankingEntry = {
  userId:          string;
  name:            string;
  rankingCategory: "PRODUCAO" | "GESTAO";
  monthPoints:     number;
  totalPoints:     number;
  position:        number;
  badges:          { badge: BadgeType; tier: number }[];
};

type Props = {
  ranking:       RankingEntry[];
  currentUserId: string;
};

const POSITION_STYLES: Record<number, { ring: string; bg: string; medal: string }> = {
  1: { ring: "ring-yellow-500/40", bg: "bg-gradient-to-r from-yellow-500/10 to-transparent", medal: "🥇" },
  2: { ring: "ring-slate-400/30",  bg: "bg-gradient-to-r from-slate-400/10 to-transparent",  medal: "🥈" },
  3: { ring: "ring-amber-700/30",  bg: "bg-gradient-to-r from-amber-700/10 to-transparent",  medal: "🥉" },
};

export default function Leaderboard({ ranking, currentUserId }: Props) {
  if (ranking.length === 0) {
    return (
      <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl p-8 text-center">
        <p className="text-slate-500 text-sm">
          Nenhuma pontuação registrada este mês ainda. Atenda o primeiro cliente para começar a competir! 🚀
        </p>
      </div>
    );
  }

  const producao = ranking.filter((r) => r.rankingCategory === "PRODUCAO");
  const gestao   = ranking.filter((r) => r.rankingCategory === "GESTAO");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <RankingColumn
        title="👷 Produção"
        subtitle="Atendentes e operação"
        entries={producao}
        currentUserId={currentUserId}
        emptyMsg="Nenhum atendente pontuou este mês."
      />
      <RankingColumn
        title="👔 Gestão"
        subtitle="Gerentes e diretoria"
        entries={gestao}
        currentUserId={currentUserId}
        emptyMsg="Nenhum gestor pontuou este mês."
      />
    </div>
  );
}

function RankingColumn({
  title, subtitle, entries, currentUserId, emptyMsg,
}: {
  title:         string;
  subtitle:      string;
  entries:       RankingEntry[];
  currentUserId: string;
  emptyMsg:      string;
}) {
  return (
    <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[#1e2d45] flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold text-sm">{title}</h3>
          <p className="text-slate-500 text-xs mt-0.5">{subtitle}</p>
        </div>
        <span className="text-slate-600 text-[11px]">{entries.length} {entries.length === 1 ? "participante" : "participantes"}</span>
      </div>

      {entries.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-slate-600 text-xs">{emptyMsg}</p>
        </div>
      ) : (
        <div className="divide-y divide-[#1e2d45]">
          {entries.map((entry) => {
            const isMe = entry.userId === currentUserId;
            const podium = POSITION_STYLES[entry.position];

            return (
              <div
                key={entry.userId}
                className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                  isMe ? "bg-indigo-500/5 ring-1 ring-inset ring-indigo-500/30" : podium?.bg ?? ""
                }`}
              >
                <div className="w-9 flex-shrink-0 text-center">
                  {podium ? (
                    <span className="text-2xl">{podium.medal}</span>
                  ) : (
                    <span className="text-slate-500 font-medium text-sm">#{entry.position}</span>
                  )}
                </div>

                <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 ${
                  isMe ? "bg-indigo-500/20 text-indigo-300 ring-2 ring-indigo-500/40"
                       : "bg-[#161f30] text-slate-400"
                }`}>
                  {entry.name.slice(0, 2).toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-medium text-xs truncate ${isMe ? "text-white" : "text-slate-200"}`}>
                      {entry.name}
                    </span>
                    {isMe && (
                      <span className="text-[8px] uppercase tracking-wider bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded">
                        você
                      </span>
                    )}
                  </div>
                  {entry.badges.length > 0 && (
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {entry.badges.slice(0, 4).map((b, i) => {
                        const tier  = BADGE_TIERS[b.badge].find((t) => t.level === b.tier);
                        const style = TIER_STYLES[b.tier];
                        return (
                          <span
                            key={i}
                            title={`${BADGE_META[b.badge].name} · N${b.tier} ${tier?.name ?? ""}`}
                            className={`text-[9px] px-1.5 py-0.5 rounded-full ${style.badgeBg} ${style.badgeText} flex items-center gap-1`}
                          >
                            {BADGE_META[b.badge].emoji}
                            <span className="font-bold">N{b.tier}</span>
                          </span>
                        );
                      })}
                      {entry.badges.length > 4 && (
                        <span className="text-slate-600 text-[9px]">+{entry.badges.length - 4}</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="text-right flex-shrink-0">
                  <div className="text-white font-bold text-base leading-none">{entry.monthPoints}</div>
                  <div className="text-slate-600 text-[10px] mt-0.5">pts</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
