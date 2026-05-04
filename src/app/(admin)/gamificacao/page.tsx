import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getRanking } from "@/lib/gamification";
import { ScoreReason, BadgeType } from "@/generated/prisma";
import MyProfileCard from "./MyProfileCard";
import Leaderboard from "./Leaderboard";
import BadgesGrid from "./BadgesGrid";
import RecentEvents from "./RecentEvents";
import ImpersonationViewSwitcher from "./ImpersonationViewSwitcher";
import AdminGrantBadge from "./AdminGrantBadge";

// Sem cache — toda visita lê os dados atuais (pontos, badges e feed atualizam
// imediatamente após qualquer ação do usuário em outras páginas).
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function GamificacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ asUser?: string }>;
}) {
  const session = await getEffectiveSession();
  if (!session) return null;

  const sessionUserId = (session.user as any).id        as string;
  const sessionName   = (session.user as any).name      as string;
  const companyId     = (session.user as any).companyId as string | undefined;
  const role          = (session.user as any).role      as string;
  const canManageUsers = !!(session.user as any).permissions?.canManageUsers;
  const isAdmin       = role === "ADMIN" || role === "SUPER_ADMIN" || canManageUsers;
  const isImpersonating = !!(session as any)._impersonating;

  if (!companyId) {
    return (
      <div className="p-6">
        <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl p-8 text-center">
          <p className="text-slate-500 text-sm">
            Você precisa estar vinculado a uma empresa para acessar a gamificação.
          </p>
        </div>
      </div>
    );
  }

  const now   = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();

  // Quando impersonando, o painel pessoal mostra o top user da empresa por
  // padrão (ou o usuário escolhido via ?asUser=). Quando não impersonando,
  // sempre mostra a pontuação do próprio super_admin/usuário logado.
  const sp = await searchParams;
  const ranking = await getRanking(companyId, month, year);

  let viewUserId   = sessionUserId;
  let viewUserName = sessionName;
  let viewedFromImpersonation = false;

  if (isImpersonating) {
    const requested = sp.asUser ? ranking.find((r) => r.userId === sp.asUser) : null;
    const target    = requested ?? ranking[0]; // fallback: top user da empresa
    if (target) {
      viewUserId   = target.userId;
      viewUserName = target.name;
      viewedFromImpersonation = true;
    }
  }

  // Lista de usuários da empresa (admin pra conceder badges)
  const allUsersInCompany = isAdmin
    ? await prisma.user.findMany({
        where:   { companyId },
        select:  { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  // Busca paralela (já com viewUserId resolvido)
  const [myScore, myBadges, myEvents, eventCounts, reiDoMesCount] = await Promise.all([
    prisma.userScore.findUnique({
      where: { userId_month_year: { userId: viewUserId, month, year } },
    }),
    prisma.userBadge.findMany({
      where:   { userId: viewUserId, companyId },
      orderBy: { earnedAt: "desc" },
    }),
    prisma.scoreEvent.findMany({
      where:   { userId: viewUserId, companyId },
      orderBy: { createdAt: "desc" },
      take:    30,
    }),
    prisma.scoreEvent.groupBy({
      by:      ["reason"],
      where:   { userId: viewUserId, companyId, points: { gt: 0 } },
      _count:  true,
    }),
    prisma.userBadge.count({
      where: { userId: viewUserId, companyId, badge: BadgeType.REI_DO_MES },
    }),
  ]);

  const counts: Partial<Record<ScoreReason, number>> = {};
  for (const row of eventCounts) counts[row.reason] = row._count;

  // ── Enriquecimento dos eventos com contexto (auditoria) ──────────────────
  // Cada ScoreEvent guarda só (reason, referenceId). Pra mostrar onde a
  // pessoa pontuou, batch-fetch os referenceIds agrupados por tipo provável.
  const CONV_REASONS = new Set<ScoreReason>([
    "RESPOSTA_RAPIDA_5MIN", "RESPOSTA_RAPIDA_30MIN",
    "ATENDIMENTO_MESMO_DIA", "RETORNO_ANTECIPADO",
    "NOTA_REGISTRADA", "PRIMEIRO_CONTATO",
    "BONUS_NOITE", "BONUS_MADRUGADA",
    "CONVERSA_SEM_RESPOSTA", "PRAZO_PRORROGADO",
    "AJUDA_EXERCITO", "ENCAMINHAMENTO", "PRIMEIRA_RESPOSTA",
  ]);
  const TICKET_REASONS = new Set<ScoreReason>(["TICKET_RESOLVIDO", "SLA_VENCIDO"]);
  const LEAD_REASONS   = new Set<ScoreReason>([
    "LEAD_AVANCADO", "LEAD_CONVERTIDO",
    "BONUS_VENDA_RAPIDA", "BONUS_RECUPERACAO",
  ]);
  const PROJECT_REASONS = new Set<ScoreReason>([
    "PROJETO_ENTREGUE", "PROJETO_ENTREGUE_NO_PRAZO", "PROJETO_ATRASADO",
    "TAREFA_SEM_PRAZO", "TAREFA_ATRASADA", "TAREFA_SEM_RESPONSAVEL",
    "TAREFA_CRIADA", "TAREFA_ATUALIZADA", "TAREFA_CONCLUIDA",
  ]);

  // Eventos de colaboração usam referenceId composto (`${convId}:${userId}:${day}:${tag}`).
  // Extraímos só o convId (prefixo até o primeiro `:`).
  function extractConvId(refId: string | null): string | null {
    if (!refId) return null;
    return refId.includes(":") ? refId.split(":")[0]! : refId;
  }

  const convIds:    string[] = [];
  const ticketIds:  string[] = [];
  const leadIds:    string[] = [];
  const projectIds: string[] = [];

  for (const ev of myEvents) {
    if (!ev.referenceId) continue;
    if (CONV_REASONS.has(ev.reason)) {
      const id = extractConvId(ev.referenceId);
      if (id) convIds.push(id);
    } else if (TICKET_REASONS.has(ev.reason)) {
      ticketIds.push(ev.referenceId);
    } else if (LEAD_REASONS.has(ev.reason)) {
      leadIds.push(ev.referenceId);
    } else if (PROJECT_REASONS.has(ev.reason) || ev.reason === "INCIDENTE") {
      projectIds.push(ev.referenceId);
    }
  }

  const [convCtx, ticketCtx, leadCtx, projectCtx] = await Promise.all([
    convIds.length > 0
      ? prisma.conversation.findMany({
          where: { id: { in: Array.from(new Set(convIds)) } },
          select: { id: true, phone: true, leads: { take: 1, orderBy: { createdAt: "desc" }, select: { name: true } } },
        })
      : Promise.resolve([]),
    ticketIds.length > 0
      ? prisma.ticket.findMany({
          where: { id: { in: Array.from(new Set(ticketIds)) } },
          select: { id: true, title: true },
        })
      : Promise.resolve([]),
    leadIds.length > 0
      ? prisma.lead.findMany({
          where: { id: { in: Array.from(new Set(leadIds)) } },
          select: { id: true, name: true, phone: true },
        })
      : Promise.resolve([]),
    projectIds.length > 0
      ? prisma.setorClickupList.findMany({
          where: { id: { in: Array.from(new Set(projectIds)) } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const convMap    = new Map(convCtx.map((c) => [c.id, c]));
  const ticketMap  = new Map(ticketCtx.map((t) => [t.id, t]));
  const leadMap    = new Map(leadCtx.map((l) => [l.id, l]));
  const projectMap = new Map(projectCtx.map((p) => [p.id, p]));

  type EnrichedEvent = (typeof myEvents)[number] & {
    contextLabel: string | null;
    contextHref:  string | null;
  };

  const enrichedEvents: EnrichedEvent[] = myEvents.map((ev) => {
    let contextLabel: string | null = null;
    let contextHref:  string | null = null;
    if (ev.referenceId) {
      if (CONV_REASONS.has(ev.reason)) {
        const cId = extractConvId(ev.referenceId);
        const c = cId ? convMap.get(cId) : null;
        if (c) {
          const leadName = c.leads[0]?.name;
          contextLabel = leadName ? `${leadName} · ${c.phone}` : c.phone;
          contextHref  = `/whatsapp?conv=${c.id}`;
        }
      } else if (TICKET_REASONS.has(ev.reason)) {
        const t = ticketMap.get(ev.referenceId);
        if (t) {
          contextLabel = t.title;
          contextHref  = `/chamados/${t.id}`;
        }
      } else if (LEAD_REASONS.has(ev.reason)) {
        const l = leadMap.get(ev.referenceId);
        if (l) {
          contextLabel = l.name ? `${l.name} · ${l.phone}` : l.phone;
          contextHref  = `/crm/leads/${l.id}`;
        }
      } else if (PROJECT_REASONS.has(ev.reason) || ev.reason === "INCIDENTE") {
        const p = projectMap.get(ev.referenceId);
        if (p) {
          contextLabel = p.name;
          contextHref  = `/projetos/${p.id}`;
        }
      }
    }
    return { ...ev, contextLabel, contextHref };
  });

  const myPosition  = ranking.findIndex((r) => r.userId === viewUserId) + 1 || null;
  const monthName   = now.toLocaleString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-white font-bold text-2xl">Painel de Performance</h1>
        <p className="text-slate-500 text-sm mt-1 capitalize">{monthName}</p>
      </div>

      {/* Banner de impersonação */}
      {viewedFromImpersonation && (
        <ImpersonationViewSwitcher
          currentUserId={viewUserId}
          users={ranking.map((r) => ({ id: r.userId, name: r.name, points: r.monthPoints }))}
        />
      )}

      {/* Layout 2 colunas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Coluna principal */}
        <div className="lg:col-span-2 space-y-5">
          <MyProfileCard
            userName={viewUserName}
            monthPoints={myScore?.monthPoints ?? 0}
            totalPoints={myScore?.totalPoints ?? 0}
            position={myPosition}
            totalUsers={ranking.length}
            earnedBadges={myBadges.map((b) => ({ badge: b.badge, tier: b.tier }))}
            counts={counts}
            reiDoMesCount={reiDoMesCount}
            isAdmin={isAdmin}
          />

          <Leaderboard ranking={ranking} currentUserId={viewUserId} />

          <RecentEvents events={enrichedEvents} />
        </div>

        {/* Coluna lateral */}
        <div className="space-y-5">
          <BadgesGrid
            counts={counts}
            reiDoMesCount={reiDoMesCount}
            earnedBadges={myBadges.map((b) => ({ badge: b.badge, tier: b.tier }))}
            isAdmin={isAdmin}
          />
        </div>
      </div>

      {/* Botão flutuante admin pra conceder badges manuais */}
      {isAdmin && allUsersInCompany.length > 0 && (
        <AdminGrantBadge users={allUsersInCompany} />
      )}
    </div>
  );
}
