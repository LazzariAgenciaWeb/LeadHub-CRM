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
import { BadgeType, ScoreReason } from "@/generated/prisma";

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

// ─── Regras de badges (6 tiers cada) ──────────────────────────────────────────
// Os nomes/limiares ficam em src/app/(admin)/gamificacao/labels.ts (BADGE_TIERS).
// Aqui só mapeamos qual ScoreReason conta para qual BadgeType e os thresholds.

type BadgeRule = {
  badge:      BadgeType;
  reasons:    ScoreReason[];
  thresholds: number[];   // [t1, t2, t3, t4, t5, t6] — espelha BADGE_TIERS em labels.ts
};

const BADGE_RULES: BadgeRule[] = [
  {
    badge: BadgeType.RAIO_VELOZ,
    reasons: [ScoreReason.RESPOSTA_RAPIDA_5MIN],
    thresholds: [3, 15, 50, 150, 500, 1500],
  },
  {
    badge: BadgeType.RESOLVEDOR,
    reasons: [ScoreReason.TICKET_RESOLVIDO],
    thresholds: [1, 5, 25, 75, 200, 500],
  },
  {
    badge: BadgeType.ANTECIPADOR,
    reasons: [ScoreReason.RETORNO_ANTECIPADO],
    thresholds: [2, 10, 25, 60, 150, 400],
  },
  {
    badge: BadgeType.CLOSER,
    reasons: [ScoreReason.LEAD_CONVERTIDO],
    thresholds: [1, 5, 15, 40, 100, 300],
  },
  {
    badge: BadgeType.PRIMEIRO_DO_DIA,
    reasons: [ScoreReason.ATENDIMENTO_MESMO_DIA],
    thresholds: [5, 25, 75, 200, 500, 1200],
  },
  {
    badge: BadgeType.ZERO_PENDENCIA,
    reasons: [ScoreReason.DIA_SEM_PENDENCIA],
    thresholds: [3, 10, 25, 60, 150, 365],
  },
  {
    badge: BadgeType.FUNIL_COMPLETO,
    reasons: [ScoreReason.LEAD_AVANCADO],
    thresholds: [5, 25, 75, 200, 500, 1500],
  },
];

// REI_DO_MES tem rule especial — é incrementado pelo cron via grantReiDoMes.
// Tiers: 1, 2, 3, 5, 10, 20 vezes campeão do mês.
const REI_DO_MES_THRESHOLDS = [1, 2, 3, 5, 10, 20];

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
): Promise<{ badge: BadgeType; tier: number }[]> {
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
 * Verifica se o usuário desbloqueou novos tiers de badges com base no
 * histórico total de ScoreEvents. Retorna array com badge+tier conquistados.
 */
export async function checkBadges(
  userId: string,
  companyId: string
): Promise<{ badge: BadgeType; tier: number }[]> {
  const newBadges: { badge: BadgeType; tier: number }[] = [];

  for (const rule of BADGE_RULES) {
    const count = await prisma.scoreEvent.count({
      where: {
        userId,
        companyId,
        reason: { in: rule.reasons },
        points: { gt: 0 },
      },
    });

    for (let i = 0; i < rule.thresholds.length; i++) {
      const tier = i + 1;
      if (count < rule.thresholds[i]) break;

      const already = await prisma.userBadge.findUnique({
        where: { userId_badge_tier: { userId, badge: rule.badge, tier } },
      });
      if (already) continue;

      await prisma.userBadge.create({
        data: { userId, companyId, badge: rule.badge, tier },
      });
      newBadges.push({ badge: rule.badge, tier });
    }
  }

  return newBadges;
}

// ─── grantReiDoMes ────────────────────────────────────────────────────────────

/**
 * Concede tier de REI_DO_MES ao líder do mês anterior. Cada vez que o usuário
 * vence o mês, sobe um tier (1ª = Estreante, 2ª = Bicampeão, ...).
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

  // Conta quantas vezes esse usuário já foi 1º (= quantos tiers já tem)
  const existingTiers = await prisma.userBadge.count({
    where: { userId: top.userId, badge: BadgeType.REI_DO_MES },
  });
  const championships = existingTiers + 1; // este mês conta

  // Encontra o maior tier que esse total destrava
  let newTier = 0;
  for (let i = 0; i < REI_DO_MES_THRESHOLDS.length; i++) {
    if (championships >= REI_DO_MES_THRESHOLDS[i]) newTier = i + 1;
  }
  if (newTier === 0) return;

  // Concede todos os tiers ainda não conquistados até newTier
  for (let tier = existingTiers + 1; tier <= newTier; tier++) {
    await prisma.userBadge.create({
      data: { userId: top.userId, companyId, badge: BadgeType.REI_DO_MES, tier },
    }).catch(() => {/* já existe */});
  }
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
  userId:      string;
  name:        string;
  monthPoints: number;
  totalPoints: number;
  position:    number;
  // Maior tier conquistado por badge (não duplica entradas do mesmo badge)
  badges:      { badge: BadgeType; tier: number }[];
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
    include: { user: { select: { id: true, name: true } } },
  });

  const userIds = scores.map((s) => s.userId);
  const badges  = await prisma.userBadge.findMany({
    where:  { companyId, userId: { in: userIds } },
    select: { userId: true, badge: true, tier: true },
  });

  // Para cada usuário × badge, mantém só o tier mais alto
  const highestByUserBadge = new Map<string, { badge: BadgeType; tier: number }>();
  for (const b of badges) {
    const key = `${b.userId}:${b.badge}`;
    const cur = highestByUserBadge.get(key);
    if (!cur || b.tier > cur.tier) {
      highestByUserBadge.set(key, { badge: b.badge, tier: b.tier });
    }
  }

  const badgesByUser: Record<string, { badge: BadgeType; tier: number }[]> = {};
  for (const [key, v] of highestByUserBadge) {
    const userId = key.split(":")[0];
    badgesByUser[userId] ??= [];
    badgesByUser[userId].push(v);
  }

  return scores.map((s, i) => ({
    userId:      s.userId,
    name:        s.user.name,
    monthPoints: s.monthPoints,
    totalPoints: s.totalPoints,
    position:    i + 1,
    badges:      (badgesByUser[s.userId] ?? []).sort((a, b) => b.tier - a.tier),
  }));
}
