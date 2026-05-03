import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getRanking } from "@/lib/gamification";
import { ScoreReason, BadgeType } from "@/generated/prisma";
import Link from "next/link";
import { Trophy, Zap, Target, ArrowRight } from "lucide-react";
import { gradStroke } from "@/components/IconGradients";
import {
  BADGE_META, BADGE_TIERS, TIER_STYLES, getBadgeProgress,
} from "../gamificacao/labels";

// Mesmo mapa do BadgesGrid — relaciona BadgeType ao ScoreReason que conta
const BADGE_REASON: Record<BadgeType, ScoreReason | null> = {
  RAIO_VELOZ:      "RESPOSTA_RAPIDA_5MIN",
  RESOLVEDOR:      "TICKET_RESOLVIDO",
  CLOSER:          "LEAD_CONVERTIDO",
  ANTECIPADOR:     "RETORNO_ANTECIPADO",
  PRIMEIRO_DO_DIA: "ATENDIMENTO_MESMO_DIA",
  ZERO_PENDENCIA:  "DIA_SEM_PENDENCIA",
  FUNIL_COMPLETO:  "LEAD_AVANCADO",
  PONTUAL:         "DIA_SEM_ATRASO",
  SPRINT_MASTER:   null,
  REI_DO_MES:      null,
};

const ALL_BADGES: BadgeType[] = [
  "RAIO_VELOZ", "RESOLVEDOR", "ANTECIPADOR", "CLOSER",
  "PRIMEIRO_DO_DIA", "ZERO_PENDENCIA", "FUNIL_COMPLETO", "PONTUAL",
];

export default async function PerformanceTeaser() {
  const session = await getEffectiveSession();
  if (!session) return null;

  const userId    = (session.user as any).id        as string;
  const companyId = (session.user as any).companyId as string | undefined;
  const isImpersonating = !!(session as any)._impersonating;

  // Esconde durante impersonação — ali não faz sentido falar de "sua" performance
  if (!companyId || isImpersonating) return null;

  const now   = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();

  const [myScore, eventCounts, ranking, openConvCount, openTicketCount, oportunidadeCount] = await Promise.all([
    prisma.userScore.findUnique({
      where: { userId_month_year: { userId, month, year } },
    }),
    prisma.scoreEvent.groupBy({
      by:     ["reason"],
      where:  { userId, companyId, points: { gt: 0 } },
      _count: true,
    }),
    getRanking(companyId, month, year),
    // Conversas em aberto atribuídas ao usuário (OPEN ou PENDING ainda esperam resposta)
    prisma.conversation.count({
      where: { companyId, assigneeId: userId, status: { in: ["OPEN", "PENDING", "IN_PROGRESS"] } },
    }),
    // Tickets atribuídos a mim, ainda não resolvidos
    prisma.ticket.count({
      where: { companyId, assigneeId: userId, status: { in: ["OPEN", "IN_PROGRESS"] } },
    }),
    // Oportunidades não fechadas (potenciais conversões)
    prisma.lead.count({
      where: { companyId, pipeline: "OPORTUNIDADES", status: { notIn: ["CLOSED", "LOST"] } },
    }),
  ]);

  const counts: Partial<Record<ScoreReason, number>> = {};
  for (const row of eventCounts) counts[row.reason] = row._count;

  // Encontra a próxima conquista mais perto: maior progresso < 100%
  let closest: {
    badge:    BadgeType;
    progress: number;
    count:    number;
    nextThr:  number;
    tierName: string;
    remaining: number;
  } | null = null;

  for (const badge of ALL_BADGES) {
    const reason = BADGE_REASON[badge];
    if (!reason) continue;
    const count = counts[reason] ?? 0;
    const { nextTier, progress } = getBadgeProgress(badge, count);
    if (!nextTier) continue; // já no nível máximo
    if (!closest || progress > closest.progress) {
      closest = {
        badge,
        progress,
        count,
        nextThr:  nextTier.threshold,
        tierName: nextTier.name,
        remaining: nextTier.threshold - count,
      };
    }
  }

  const myPosition = ranking.findIndex((r) => r.userId === userId) + 1 || null;
  const monthPoints = myScore?.monthPoints ?? 0;

  // Total de ações pendentes = potencial de pontos imediato
  const totalActionable = openConvCount + openTicketCount + oportunidadeCount;
  if (monthPoints === 0 && totalActionable === 0) return null; // ninguém atendendo nada — esconde

  const positionLabel = myPosition
    ? myPosition === 1 ? "🥇 1º lugar"
      : myPosition === 2 ? "🥈 2º lugar"
      : myPosition === 3 ? "🥉 3º lugar"
      : `#${myPosition} de ${ranking.length}`
    : "—";

  const closestMeta  = closest ? BADGE_META[closest.badge] : null;
  const closestStyle = closest ? TIER_STYLES[
    (BADGE_TIERS[closest.badge].find((t) => t.threshold === closest.nextThr)?.level ?? 1)
  ] : null;

  return (
    <div className="bg-gradient-to-br from-yellow-500/5 via-orange-500/5 to-fuchsia-500/5 border border-yellow-500/20 rounded-2xl p-5">
      {/* Header com posição */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500/20 to-orange-500/10 border border-yellow-500/30 flex items-center justify-center flex-shrink-0">
            <Trophy className="w-5 h-5" stroke={gradStroke("gamificacao")} strokeWidth={2} />
          </div>
          <div>
            <h3 className="text-white font-semibold text-sm">Sua performance no mês</h3>
            <p className="text-slate-500 text-xs mt-0.5">
              <span className="text-yellow-400 font-medium">{monthPoints} pts</span>
              {" · "}
              {positionLabel}
            </p>
          </div>
        </div>
        <Link
          href="/gamificacao"
          className="text-xs text-yellow-300/70 hover:text-yellow-300 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-yellow-500/10 transition-colors"
        >
          Ver painel <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Próxima conquista */}
        {closest && closestMeta && closestStyle && (
          <div className={`rounded-xl border border-transparent ring-1 ${closestStyle.ring} ${closestStyle.bg} p-3`}>
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-3.5 h-3.5 text-fuchsia-300" />
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Próxima conquista</span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">{closestMeta.emoji}</span>
              <div className="min-w-0">
                <div className="text-white text-sm font-semibold truncate">{closestMeta.name}</div>
                <div className={`text-[11px] font-bold ${closestStyle.text}`}>
                  → {closest.tierName}
                </div>
              </div>
            </div>
            <div className="h-1.5 bg-[#080b12] rounded-full overflow-hidden mb-1">
              <div
                className="h-full bg-gradient-to-r from-fuchsia-500 to-purple-500"
                style={{ width: `${closest.progress * 100}%` }}
              />
            </div>
            <p className="text-slate-400 text-[11px]">
              Faltam <span className="text-white font-bold">{closest.remaining}</span> {closest.remaining === 1 ? "ação" : "ações"} pra desbloquear
            </p>
          </div>
        )}

        {/* Pode pontuar agora */}
        <div className="bg-[#080b12]/50 border border-[#1e2d45] rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[10px] uppercase tracking-wider text-slate-400">Pode pontuar agora</span>
          </div>
          <div className="space-y-1.5 text-xs">
            {openConvCount > 0 && (
              <Link href="/whatsapp" className="flex items-center justify-between hover:bg-white/5 -mx-1 px-1 py-0.5 rounded transition-colors">
                <span className="text-slate-300">
                  💬 {openConvCount} {openConvCount === 1 ? "conversa pendente" : "conversas pendentes"}
                </span>
                <span className="text-emerald-400 font-bold text-[11px]">+10 cada</span>
              </Link>
            )}
            {openTicketCount > 0 && (
              <Link href="/chamados" className="flex items-center justify-between hover:bg-white/5 -mx-1 px-1 py-0.5 rounded transition-colors">
                <span className="text-slate-300">
                  🎫 {openTicketCount} {openTicketCount === 1 ? "chamado seu aberto" : "chamados seus abertos"}
                </span>
                <span className="text-emerald-400 font-bold text-[11px]">+15 cada</span>
              </Link>
            )}
            {oportunidadeCount > 0 && (
              <Link href="/crm/oportunidades" className="flex items-center justify-between hover:bg-white/5 -mx-1 px-1 py-0.5 rounded transition-colors">
                <span className="text-slate-300">
                  💰 {oportunidadeCount} {oportunidadeCount === 1 ? "oportunidade no funil" : "oportunidades no funil"}
                </span>
                <span className="text-emerald-400 font-bold text-[11px]">+50 cada</span>
              </Link>
            )}
            {totalActionable === 0 && (
              <p className="text-slate-600 text-[11px]">
                Nada na fila. Volte mais tarde — novas conversas e chamados liberam pontos.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
