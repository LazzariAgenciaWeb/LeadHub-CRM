import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getRanking } from "@/lib/gamification";
import { ScoreReason, BadgeType } from "@/generated/prisma";
import Link from "next/link";
import { Trophy, ArrowRight } from "lucide-react";
import BadgeMedallion from "../gamificacao/BadgeMedallion";
import { BADGE_TIERS } from "../gamificacao/labels";

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

export default async function DashboardGamificacaoTop() {
  const session = await getEffectiveSession();
  if (!session) return null;

  const userId    = (session.user as any).id        as string;
  const companyId = (session.user as any).companyId as string | undefined;
  const isImpersonating = !!(session as any)._impersonating;

  if (!companyId || isImpersonating) return null;

  const now   = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();

  // Carrega tudo em paralelo
  const [myScore, myBadges, eventCounts, reiDoMesCount, ranking] = await Promise.all([
    prisma.userScore.findUnique({
      where: { userId_month_year: { userId, month, year } },
    }),
    prisma.userBadge.findMany({
      where:  { userId, companyId },
      select: { badge: true, tier: true },
    }),
    prisma.scoreEvent.groupBy({
      by:     ["reason"],
      where:  { userId, companyId, points: { gt: 0 } },
      _count: true,
    }),
    prisma.userBadge.count({
      where: { userId, companyId, badge: BadgeType.REI_DO_MES },
    }),
    getRanking(companyId, month, year),
  ]);

  const counts: Partial<Record<ScoreReason, number>> = {};
  for (const row of eventCounts) counts[row.reason] = row._count;

  // Maior tier por badge (piso de progresso)
  const maxTierByBadge = new Map<BadgeType, number>();
  for (const b of myBadges) {
    const cur = maxTierByBadge.get(b.badge) ?? 0;
    if (b.tier > cur) maxTierByBadge.set(b.badge, b.tier);
  }
  function effectiveCount(badge: BadgeType): number {
    const reason = BADGE_REASON[badge];
    const fromEvents = badge === "REI_DO_MES" ? reiDoMesCount
                     : reason ? (counts[reason] ?? 0) : 0;
    const earnedTier = maxTierByBadge.get(badge) ?? 0;
    if (earnedTier === 0) return fromEvents;
    const tierThreshold = BADGE_TIERS[badge][earnedTier - 1].threshold;
    return Math.max(fromEvents, tierThreshold);
  }

  // Determina a categoria do usuário e filtra ranking
  const me = ranking.find((r) => r.userId === userId);
  const myCategory = me?.rankingCategory ?? "PRODUCAO";
  const sameCategory = ranking.filter((r) => r.rankingCategory === myCategory);
  const top5 = sameCategory.slice(0, 5);
  const myPosition = sameCategory.findIndex((r) => r.userId === userId) + 1;

  // Se o usuário não está no top 5, adiciona ele à lista
  const showsMe = top5.some((r) => r.userId === userId);

  const monthPoints = myScore?.monthPoints ?? 0;
  const distinctEarned = new Set(myBadges.map((b) => b.badge)).size;

  // Se o user não tem nenhum dado e não há ranking, esconde tudo
  if (monthPoints === 0 && distinctEarned === 0 && ranking.length === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Medalhões — coluna principal */}
      <div className="lg:col-span-2 bg-gradient-to-br from-[#0a0f1a] to-[#0f1623] border border-[#1e2d45] rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-white font-semibold text-sm flex items-center gap-2">
              🎖️ Suas conquistas
            </h3>
            <p className="text-slate-500 text-xs mt-0.5">
              {distinctEarned} de {ALL_BADGES.length} desbloqueadas · {monthPoints} pts no mês
            </p>
          </div>
          <Link
            href="/gamificacao"
            className="text-xs text-yellow-300/70 hover:text-yellow-300 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-yellow-500/10 transition-colors"
          >
            Ver painel <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="grid grid-cols-5 sm:grid-cols-7 gap-2">
          {ALL_BADGES.map((badge) => (
            <BadgeMedallion key={badge} badge={badge} count={effectiveCount(badge)} size={56} />
          ))}
        </div>
      </div>

      {/* Mini Ranking — coluna lateral */}
      <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-white font-semibold text-sm flex items-center gap-2">
              <Trophy className="w-4 h-4 text-yellow-400" /> Ranking
            </h3>
            <p className="text-slate-500 text-xs mt-0.5">
              Top {myCategory === "GESTAO" ? "Gestão" : "Produção"} no mês
            </p>
          </div>
          <Link
            href="/gamificacao"
            className="text-[10px] text-slate-500 hover:text-white"
          >
            ver todos
          </Link>
        </div>

        {ranking.length === 0 ? (
          <p className="text-slate-600 text-xs text-center py-6">
            Ninguém pontuou ainda.
          </p>
        ) : (
          <div className="space-y-1.5">
            {top5.map((entry) => {
              const isMe = entry.userId === userId;
              const medal = entry.position === 1 ? "🥇"
                          : entry.position === 2 ? "🥈"
                          : entry.position === 3 ? "🥉"
                          : null;
              return (
                <div
                  key={entry.userId}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${
                    isMe ? "bg-indigo-500/10 ring-1 ring-indigo-500/30" : ""
                  }`}
                >
                  <span className="w-6 text-center text-sm flex-shrink-0">
                    {medal ?? <span className="text-slate-500 text-xs">#{entry.position}</span>}
                  </span>
                  <span className={`flex-1 truncate text-xs ${isMe ? "text-white font-medium" : "text-slate-300"}`}>
                    {entry.name}
                    {isMe && <span className="ml-1 text-[9px] uppercase tracking-wider text-indigo-300">você</span>}
                  </span>
                  <span className={`text-xs font-bold ${isMe ? "text-white" : "text-slate-400"}`}>
                    {entry.monthPoints}
                  </span>
                </div>
              );
            })}

            {!showsMe && me && myPosition > 0 && (
              <>
                <div className="text-center text-slate-700 text-[10px] py-0.5">···</div>
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-indigo-500/10 ring-1 ring-indigo-500/30">
                  <span className="w-6 text-center">
                    <span className="text-slate-500 text-xs">#{myPosition}</span>
                  </span>
                  <span className="flex-1 truncate text-xs text-white font-medium">
                    {me.name}
                    <span className="ml-1 text-[9px] uppercase tracking-wider text-indigo-300">você</span>
                  </span>
                  <span className="text-xs font-bold text-white">{me.monthPoints}</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
