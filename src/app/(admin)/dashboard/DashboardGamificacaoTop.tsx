import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getRanking } from "@/lib/gamification";
import { ScoreReason, BadgeType } from "@/generated/prisma";
import Link from "next/link";
import { ArrowRight, Lock, Sparkles } from "lucide-react";
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

  // Módulo não contratado → renderiza card preview com CTA pra solicitar.
  // Antes a seção sumia totalmente; cliente nem sabia que existia.
  if (!gamificacaoEnabled) {
    return <GamificacaoLockedCard companyId={companyId} />;
  }

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

// ─────────────────────────────────────────────────────────────────────────────
// Card de preview pra empresas SEM o módulo Gamificação contratado.
// Mostra os medalhões em silhueta + CTA pra solicitar via WhatsApp.
// ─────────────────────────────────────────────────────────────────────────────
function GamificacaoLockedCard({ companyId }: { companyId: string }) {
  const supportPhone = "5544999015088";
  const msg = encodeURIComponent(
    `Olá! Gostaria de ativar o módulo de Gamificação no LeadHub. Empresa ID: ${companyId}`,
  );
  const requestUrl = `https://wa.me/${supportPhone}?text=${msg}`;
  // Mostra um subset de badges pra dar sensação do que existe sem revelar tudo
  const previewBadges = ALL_BADGES.slice(0, 7);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Card principal — medalhões em silhueta */}
      <div className="lg:col-span-2 relative bg-gradient-to-br from-[#0a0f1a] to-[#0f1623] border border-[#1e2d45] rounded-2xl p-5 overflow-hidden">
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-semibold text-sm flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-amber-400" strokeWidth={2} />
              Gamificação
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold uppercase tracking-wider">
                Não contratado
              </span>
            </h3>
            <p className="text-slate-500 text-xs mt-1 leading-relaxed">
              Pontue cada ação dos atendentes, libere medalhas por desempenho e veja o
              ranking ao vivo. Aumenta o engajamento da equipe e ajuda a identificar
              top performers.
            </p>
          </div>
          <a
            href={requestUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-semibold transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Solicitar
          </a>
        </div>

        {/* Medalhões em silhueta — visual do que tem */}
        <div className="grid grid-cols-5 sm:grid-cols-7 gap-2 opacity-40 grayscale pointer-events-none">
          {previewBadges.map((badge) => (
            <BadgeMedallion key={badge} badge={badge} count={0} size={56} />
          ))}
        </div>

        {/* Overlay sutil reforçando estado bloqueado */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0f1a]/40 to-transparent pointer-events-none" />
      </div>

      {/* Card lateral — ranking placeholder */}
      <div className="relative bg-[#0f1623] border border-[#1e2d45] rounded-2xl p-5 overflow-hidden">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2 mb-2">
          <Lock className="w-3.5 h-3.5 text-amber-400" strokeWidth={2} />
          Ranking
        </h3>
        <p className="text-slate-500 text-xs leading-relaxed mb-4">
          Ranking mensal da equipe — quem mais converteu, atendeu rápido, fechou negócios.
        </p>
        <div className="space-y-2 opacity-40 pointer-events-none">
          {["🥇", "🥈", "🥉"].map((medal, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/5">
              <span className="text-base">{medal}</span>
              <span className="flex-1 h-3 rounded bg-white/10" />
              <span className="text-[10px] text-slate-600 font-mono">— pts</span>
            </div>
          ))}
        </div>
        <a
          href={requestUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 block text-center text-[11px] text-amber-300 hover:text-amber-200 font-semibold"
        >
          Solicitar contratação →
        </a>
      </div>
    </div>
  );
}
