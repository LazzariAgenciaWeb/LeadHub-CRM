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

  // Módulo não contratado → renderiza a UI real BORRADA com overlay de
  // contratação centralizado. Cliente vê uma prévia do que vai ter, com
  // CTA "Contratar módulo" no meio. Padrão paywall comum (Spotify, Notion).
  if (!gamificacaoEnabled) {
    return <GamificacaoLockedPreview companyId={companyId} />;
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
// Preview borrado da Gamificação pra empresas sem o módulo. Renderiza um
// clone visual do card real com dados-fake, aplica blur + saturate-0 em
// cima, e centraliza um botão "Contratar módulo" — padrão paywall.
// ─────────────────────────────────────────────────────────────────────────────
function GamificacaoLockedPreview({ companyId }: { companyId: string }) {
  const supportPhone = "5544999015088";
  const msg = encodeURIComponent(
    `Olá! Gostaria de ativar o módulo de Gamificação no LeadHub. Empresa ID: ${companyId}`,
  );
  const requestUrl = `https://wa.me/${supportPhone}?text=${msg}`;
  // Nomes fake só pro visual do ranking — não vaza dado real.
  const fakeRanking = [
    { medal: "🥇", name: "Ana Silva",     pts: 1240 },
    { medal: "🥈", name: "Bruno Costa",   pts: 980  },
    { medal: "🥉", name: "Cosmo",         pts: 720  },
    { medal: "#4", name: "Diego",         pts: 510  },
    { medal: "#5", name: "Mariana",       pts: 320  },
  ];

  return (
    <div className="relative">
      {/* Conteúdo real-look BORRADO embaixo. pointer-events-none impede
          interação. aria-hidden some pra leitores de tela. */}
      <div
        className="grid grid-cols-1 lg:grid-cols-3 gap-4 blur-sm saturate-50 opacity-70 pointer-events-none select-none"
        aria-hidden="true"
      >
        {/* Coluna principal — medalhões */}
        <div className="lg:col-span-2 bg-gradient-to-br from-[#0a0f1a] to-[#0f1623] border border-[#1e2d45] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-white font-semibold text-sm">🎖️ Suas conquistas</h3>
              <p className="text-slate-500 text-xs mt-0.5">
                12 de 27 desbloqueadas · 847 pts no mês
              </p>
            </div>
          </div>
          <div className="grid grid-cols-5 sm:grid-cols-7 gap-2">
            {ALL_BADGES.slice(0, 14).map((badge) => (
              <BadgeMedallion key={badge} badge={badge} count={Math.floor(Math.random() * 30)} size={56} />
            ))}
          </div>
        </div>

        {/* Coluna lateral — ranking */}
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-white font-semibold text-sm">🏆 Ranking</h3>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </div>
          <p className="text-slate-500 text-[10px] mb-3">Ranking do mês — atualiza a cada 30s</p>
          <div className="space-y-1.5">
            {fakeRanking.map((r, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/5">
                <span className="text-sm w-6">{r.medal}</span>
                <span className="flex-1 text-slate-200 text-[12px] truncate">{r.name}</span>
                <span className="text-amber-300 text-[11px] font-mono font-bold">{r.pts}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Overlay com CTA centralizado */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="bg-[#0a0f1a]/85 backdrop-blur-sm border border-amber-500/30 rounded-2xl px-6 py-5 max-w-md text-center shadow-2xl shadow-amber-500/10">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Lock className="w-4 h-4 text-amber-400" strokeWidth={2.5} />
            <span className="text-[11px] uppercase tracking-wider font-bold text-amber-400">
              Módulo não contratado
            </span>
          </div>
          <h3 className="text-white font-bold text-lg mb-1.5">Gamificação</h3>
          <p className="text-slate-400 text-xs leading-relaxed mb-4 max-w-sm">
            Pontue cada ação dos atendentes, libere medalhas por desempenho e veja
            o ranking ao vivo. Aumenta engajamento e ajuda a identificar top performers.
          </p>
          <a
            href={requestUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-[#0a0f1a] font-bold text-sm transition-all shadow-lg shadow-amber-500/30"
          >
            <Sparkles className="w-4 h-4" />
            Contratar módulo
          </a>
        </div>
      </div>
    </div>
  );
}
