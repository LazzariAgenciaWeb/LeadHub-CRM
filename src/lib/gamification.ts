/**
 * Motor de gamificação do LeadHub.
 *
 * Uso típico (dentro de uma rota de API, após uma ação do atendente):
 *
 *   import { addScore } from "@/lib/gamification";
 *   await addScore(userId, companyId, "RESPOSTA_RAPIDA_5MIN", conversationId);
 *
 * O addScore já:
 *   1. Persiste o ScoreEvent
 *   2. Atualiza o UserScore (mês corrente + total histórico)
 *   3. Chama checkBadges para ver se novas conquistas foram desbloqueadas
 */

import { prisma } from "@/lib/prisma";
import { BadgeLevel, BadgeType, ScoreReason } from "@/generated/prisma";

// ─── Tabela de pontos por razão ───────────────────────────────────────────────

export const SCORE_TABLE: Record<ScoreReason, number> = {
  RESPOSTA_RAPIDA_5MIN:    10,
  RESPOSTA_RAPIDA_30MIN:    5,
  TICKET_RESOLVIDO:        15,
  LEAD_AVANCADO:            8,
  LEAD_CONVERTIDO:         50,
  DIA_SEM_PENDENCIA:       20,
  RETORNO_ANTECIPADO:      12,
  ATENDIMENTO_MESMO_DIA:    5,
  NOTA_REGISTRADA:          2,
  // Penalidades (pontos negativos)
  SLA_VENCIDO:            -15,
  CONVERSA_SEM_RESPOSTA:  -10,
};

// ─── Regras de badges ─────────────────────────────────────────────────────────
// Cada badge tem 3 níveis. O threshold é o número de ocorrências necessárias.
// "ocorrência" = quantidade de ScoreEvents com o(s) reason(s) correspondente(s).

type BadgeRule = {
  badge:    BadgeType;
  reasons:  ScoreReason[];   // eventos que contam para este badge
  thresholds: Record<BadgeLevel, number>;
};

const BADGE_RULES: BadgeRule[] = [
  {
    badge: BadgeType.RAIO_VELOZ,
    reasons: [ScoreReason.RESPOSTA_RAPIDA_5MIN],
    thresholds: { BRONZE: 10, PRATA: 30, OURO: 50 },
  },
  {
    badge: BadgeType.RESOLVEDOR,
    reasons: [ScoreReason.TICKET_RESOLVIDO],
    thresholds: { BRONZE: 5, PRATA: 20, OURO: 50 },
  },
  {
    badge: BadgeType.ANTECIPADOR,
    reasons: [ScoreReason.RETORNO_ANTECIPADO],
    thresholds: { BRONZE: 3, PRATA: 10, OURO: 25 },
  },
  {
    badge: BadgeType.CLOSER,
    reasons: [ScoreReason.LEAD_CONVERTIDO],
    thresholds: { BRONZE: 1, PRATA: 5, OURO: 15 },
  },
  {
    badge: BadgeType.PRIMEIRO_DO_DIA,
    reasons: [ScoreReason.ATENDIMENTO_MESMO_DIA],
    thresholds: { BRONZE: 10, PRATA: 30, OURO: 75 },
  },
  {
    badge: BadgeType.ZERO_PENDENCIA,
    reasons: [ScoreReason.DIA_SEM_PENDENCIA],
    thresholds: { BRONZE: 5, PRATA: 15, OURO: 30 },
  },
  {
    badge: BadgeType.FUNIL_COMPLETO,
    reasons: [ScoreReason.LEAD_AVANCADO],
    thresholds: { BRONZE: 10, PRATA: 30, OURO: 100 },
  },
];

const LEVEL_ORDER: BadgeLevel[] = [BadgeLevel.BRONZE, BadgeLevel.PRATA, BadgeLevel.OURO];

// ─── addScore ─────────────────────────────────────────────────────────────────

/**
 * Registra um evento de pontuação e atualiza o placar do usuário.
 * Retorna os badges recém-conquistados (para notificação na UI).
 */
export async function addScore(
  userId:      string,
  companyId:   string,
  reason:      ScoreReason,
  referenceId?: string
): Promise<BadgeType[]> {
  const points = SCORE_TABLE[reason];
  const now = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();

  await prisma.$transaction([
    // 1. Persiste o evento
    prisma.scoreEvent.create({
      data: { userId, companyId, points, reason, referenceId },
    }),
    // 2. Upsert no placar mensal (cria se não existir, incrementa se já existir)
    prisma.userScore.upsert({
      where: { userId_month_year: { userId, month, year } },
      create: {
        userId,
        companyId,
        month,
        year,
        monthPoints: Math.max(0, points),
        totalPoints: Math.max(0, points),
      },
      update: {
        monthPoints: { increment: points },
        totalPoints: { increment: points },
      },
    }),
  ]);

  // Garante que monthPoints não fique negativo (Prisma não suporta MAX em update)
  await prisma.userScore.updateMany({
    where: { userId, month, year, monthPoints: { lt: 0 } },
    data:  { monthPoints: 0 },
  });

  return checkBadges(userId, companyId);
}

// ─── checkBadges ──────────────────────────────────────────────────────────────

/**
 * Verifica se o usuário desbloqueou novos badges com base no histórico total
 * de ScoreEvents. Retorna array com os BadgeTypes recém-conquistados.
 */
export async function checkBadges(
  userId: string,
  companyId: string
): Promise<BadgeType[]> {
  const newBadges: BadgeType[] = [];

  for (const rule of BADGE_RULES) {
    const count = await prisma.scoreEvent.count({
      where: {
        userId,
        companyId,
        reason: { in: rule.reasons },
        points: { gt: 0 },
      },
    });

    for (const level of LEVEL_ORDER) {
      if (count < rule.thresholds[level]) break;

      const already = await prisma.userBadge.findUnique({
        where: { userId_badge_level: { userId, badge: rule.badge, level } },
      });
      if (already) continue;

      await prisma.userBadge.create({
        data: { userId, companyId, badge: rule.badge, level },
      });
      newBadges.push(rule.badge);
    }
  }

  return newBadges;
}

// ─── grantReiDoMes ────────────────────────────────────────────────────────────

/**
 * Concede o badge REI_DO_MES ao líder do mês anterior.
 * Chamado pelo cron no dia 1 de cada mês.
 */
export async function grantReiDoMes(companyId: string): Promise<void> {
  const now   = new Date();
  const month = now.getMonth() === 0 ? 12 : now.getMonth();
  const year  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  const top = await prisma.userScore.findFirst({
    where:   { companyId, month, year },
    orderBy: { monthPoints: "desc" },
  });
  if (!top || top.monthPoints === 0) return;

  const already = await prisma.userBadge.findUnique({
    where: { userId_badge_level: { userId: top.userId, badge: BadgeType.REI_DO_MES, level: BadgeLevel.OURO } },
  });
  if (already) return;

  await prisma.userBadge.create({
    data: { userId: top.userId, companyId, badge: BadgeType.REI_DO_MES, level: BadgeLevel.OURO },
  });
}

// ─── resetMonthlyScores ───────────────────────────────────────────────────────

/**
 * Zera monthPoints para todos os usuários da empresa.
 * Chamado pelo cron no dia 1 de cada mês (APÓS grantReiDoMes).
 * totalPoints nunca é alterado.
 */
export async function resetMonthlyScores(companyId: string): Promise<void> {
  const now   = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();

  // Cria o registro vazio do novo mês para todos que já tiveram pontuação
  const previous = await prisma.userScore.findMany({
    where:  { companyId },
    select: { userId: true },
    distinct: ["userId"],
  });

  await prisma.$transaction(
    previous.map((s) =>
      prisma.userScore.upsert({
        where:  { userId_month_year: { userId: s.userId, month, year } },
        create: { userId: s.userId, companyId, month, year, monthPoints: 0, totalPoints: 0 },
        update: { monthPoints: 0 },
      })
    )
  );
}

// ─── runDailyPenalties ────────────────────────────────────────────────────────

/**
 * Aplica penalidades diárias:
 *   - Conversas há mais de 24h úteis sem resposta do atendente
 *   - Tickets com SLA vencido (dueDate < agora e status não finalizado)
 *
 * Chamado pelo cron uma vez por dia (ex: ao início do horário comercial).
 */
export async function runDailyPenalties(companyId: string): Promise<void> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Conversas OPEN/IN_PROGRESS sem firstResponseAt há mais de 24h
  const staleConversations = await prisma.conversation.findMany({
    where: {
      companyId,
      status:          { in: ["OPEN", "IN_PROGRESS"] },
      firstResponseAt: null,
      createdAt:       { lt: yesterday },
      assigneeId:      { not: null },
    },
    select: { id: true, assigneeId: true },
  });

  for (const conv of staleConversations) {
    if (!conv.assigneeId) continue;
    // Evita duplicar penalidade no mesmo dia
    const alreadyToday = await prisma.scoreEvent.findFirst({
      where: {
        userId:      conv.assigneeId,
        companyId,
        reason:      ScoreReason.CONVERSA_SEM_RESPOSTA,
        referenceId: conv.id,
        createdAt:   { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    });
    if (alreadyToday) continue;
    await addScore(conv.assigneeId, companyId, ScoreReason.CONVERSA_SEM_RESPOSTA, conv.id);
  }

  // Tickets com dueDate vencido e status aberto
  const overdueTickets = await prisma.ticket.findMany({
    where: {
      companyId,
      status:    { in: ["OPEN", "IN_PROGRESS"] },
      dueDate:   { lt: new Date() },
      assigneeId: { not: null },
    },
    select: { id: true, assigneeId: true },
  });

  for (const ticket of overdueTickets) {
    if (!ticket.assigneeId) continue;
    const alreadyToday = await prisma.scoreEvent.findFirst({
      where: {
        userId:      ticket.assigneeId,
        companyId,
        reason:      ScoreReason.SLA_VENCIDO,
        referenceId: ticket.id,
        createdAt:   { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    });
    if (alreadyToday) continue;
    await addScore(ticket.assigneeId, companyId, ScoreReason.SLA_VENCIDO, ticket.id);
  }
}

// ─── getRanking ───────────────────────────────────────────────────────────────

export type RankingEntry = {
  userId:     string;
  name:       string;
  monthPoints: number;
  totalPoints: number;
  position:   number;
  badges:     { badge: BadgeType; level: BadgeLevel }[];
};

export async function getRanking(
  companyId: string,
  month?: number,
  year?: number
): Promise<RankingEntry[]> {
  const now = new Date();
  const m = month ?? now.getMonth() + 1;
  const y = year  ?? now.getFullYear();

  const scores = await prisma.userScore.findMany({
    where:   { companyId, month: m, year: y },
    orderBy: { monthPoints: "desc" },
    include: {
      user: { select: { id: true, name: true } },
    },
  });

  const userIds = scores.map((s) => s.userId);
  const badges  = await prisma.userBadge.findMany({
    where: { companyId, userId: { in: userIds } },
    select: { userId: true, badge: true, level: true },
  });

  const badgesByUser = badges.reduce<Record<string, { badge: BadgeType; level: BadgeLevel }[]>>(
    (acc, b) => {
      acc[b.userId] ??= [];
      acc[b.userId].push({ badge: b.badge, level: b.level });
      return acc;
    },
    {}
  );

  return scores.map((s, i) => ({
    userId:      s.userId,
    name:        s.user.name,
    monthPoints: s.monthPoints,
    totalPoints: s.totalPoints,
    position:    i + 1,
    badges:      badgesByUser[s.userId] ?? [],
  }));
}
