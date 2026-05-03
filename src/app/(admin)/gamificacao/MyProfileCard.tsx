import { Trophy, TrendingUp, Award } from "lucide-react";
import { gradStroke } from "@/components/IconGradients";
import { BadgeType, ScoreReason } from "@/generated/prisma";
import BadgeMedallion from "./BadgeMedallion";

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
  CONSTRUTOR:      "TAREFA_CONCLUIDA",
  ENGAJADO:        "TAREFA_ATUALIZADA",
  GERADOR:         "TAREFA_CRIADA",
  SPRINT_MASTER:   null,
  REI_DO_MES:      null,
};

const ALL_BADGES: BadgeType[] = [
  "RAIO_VELOZ", "RESOLVEDOR", "CLOSER", "ANTECIPADOR",
  "PRIMEIRO_DO_DIA", "ZERO_PENDENCIA", "FUNIL_COMPLETO",
  "PONTUAL", "ENTREGADOR", "CONSTRUTOR", "ENGAJADO", "GERADOR",
  "SPRINT_MASTER", "REI_DO_MES",
];

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
};

export default function MyProfileCard({
  userName, monthPoints, totalPoints, position, totalUsers,
  earnedBadges, counts, reiDoMesCount,
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

  // Conta efetiva por badge (max entre eventos atuais e threshold do tier conquistado)
  function effectiveCount(badge: BadgeType): number {
    const reason = BADGE_REASON[badge];
    const fromEvents = badge === "REI_DO_MES"
      ? reiDoMesCount
      : reason ? (counts[reason] ?? 0) : 0;
    const earnedTier = maxTierByBadge.get(badge) ?? 0;
    if (earnedTier === 0) return fromEvents;
    // import dinâmico via labels é puxado direto pelo medalhão; aqui só
    // priorizamos a contagem real. Threshold-piso fica a cargo do BadgeMedallion.
    return fromEvents;
  }

  const distinctEarned = new Set(earnedBadges.map((b) => b.badge)).size;

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

      <div className="mt-4 pt-4 border-t border-[#1e2d45] flex items-center justify-between text-xs">
        <span className="text-slate-500">Acumulado total</span>
        <span className="text-white font-medium">{totalPoints} pts</span>
      </div>

      {/* Medalhões — barra termômetro circular por badge */}
      <div className="mt-5 pt-5 border-t border-[#1e2d45]">
        <p className="text-slate-500 text-[10px] uppercase tracking-wider mb-3">
          Suas conquistas — termômetro de progresso
        </p>
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
          {ALL_BADGES.map((badge) => (
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
