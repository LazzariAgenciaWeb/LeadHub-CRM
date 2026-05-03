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
  PRIMEIRO_CONTATO:         3,   // triagem em conversa que não é sua (idempotente por conversa)
  DIA_SEM_ATRASO:          15,   // dia terminado sem nada atrasado (cron)
  PROJETO_ENTREGUE:        50,   // projeto marcado como ENTREGUE (idempotente)
  PROJETO_ENTREGUE_NO_PRAZO: 25, // bônus se entregue antes/no prazo
  // Penalidades (pontos negativos)
  SLA_VENCIDO:            -15,
  CONVERSA_SEM_RESPOSTA:  -10,
  PRAZO_PRORROGADO:        -5,   // empurrar prazo depois de vencido (cumulativo)
  PROJETO_ATRASADO:       -30,   // projeto entregue depois do dueDate
  TAREFA_SEM_PRAZO:        -3,   // tarefas no ClickUp sem due_date (cron diário)
  TAREFA_CRIADA:            1,   // tarefa criada no ClickUp (sync)
  TAREFA_ATUALIZADA:        1,   // tarefa atualizada no ClickUp (sync)
  TAREFA_CONCLUIDA:         3,   // tarefa concluída no ClickUp (sync)
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
  {
    badge: BadgeType.PONTUAL,
    reasons: [ScoreReason.DIA_SEM_ATRASO],
    thresholds: [3, 10, 25, 60, 150, 365],
  },
  {
    badge: BadgeType.ENTREGADOR,
    reasons: [ScoreReason.PROJETO_ENTREGUE_NO_PRAZO],
    thresholds: [1, 3, 8, 20, 50, 150],
  },
  {
    badge: BadgeType.CONSTRUTOR,
    reasons: [ScoreReason.TAREFA_CONCLUIDA],
    thresholds: [5, 25, 75, 200, 500, 1500],
  },
  {
    badge: BadgeType.ENGAJADO,
    reasons: [ScoreReason.TAREFA_ATUALIZADA],
    thresholds: [10, 50, 150, 500, 1500, 5000],
  },
  {
    badge: BadgeType.GERADOR,
    reasons: [ScoreReason.TAREFA_CRIADA],
    thresholds: [5, 20, 60, 150, 400, 1000],
  },
];

// REI_DO_MES tem rule especial — é incrementado pelo cron via grantReiDoMes.
// Tiers: 1, 2, 3, 5, 10, 20 vezes campeão do mês.
const REI_DO_MES_THRESHOLDS = [1, 2, 3, 5, 10, 20];

// ─── addScore ─────────────────────────────────────────────────────────────────

/**
 * Lê a regra configurada da empresa pra esta razão. Faz fallback pro SCORE_TABLE.
 * Retorna null se a razão estiver desabilitada (ScoreRuleConfig.enabled = false).
 */
async function resolveRule(
  companyId: string,
  reason:    ScoreReason,
): Promise<{ points: number; affectsRanking: boolean } | null> {
  const cfg = await prisma.scoreRuleConfig.findUnique({
    where: { companyId_reason: { companyId, reason } },
  });
  if (cfg) {
    if (!cfg.enabled) return null;
    return { points: cfg.points, affectsRanking: cfg.affectsRanking };
  }
  // Sem config explícita: usa default e considera no ranking
  return { points: SCORE_TABLE[reason], affectsRanking: true };
}

/**
 * Registra um evento de pontuação e atualiza o placar do usuário.
 * Respeita ScoreRuleConfig:
 *  - Se enabled=false → nada acontece
 *  - Se affectsRanking=false → cria ScoreEvent (badge conta) mas NÃO incrementa UserScore
 *
 * Retorna os badges recém-conquistados (para notificação na UI).
 */
export async function addScore(
  userId:      string,
  companyId:   string,
  reason:      ScoreReason,
  referenceId?: string
): Promise<{ badge: BadgeType; tier: number }[]> {
  const rule = await resolveRule(companyId, reason);
  if (!rule) return []; // razão desabilitada

  const points = rule.points;
  const now = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();

  // Sempre persiste o ScoreEvent (badge depende dele)
  await prisma.scoreEvent.create({
    data: { userId, companyId, points, reason, referenceId },
  });

  // Só atualiza o placar se a razão afeta ranking
  if (rule.affectsRanking) {
    await prisma.userScore.upsert({
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
    });

    // Garante que monthPoints não fique negativo
    await prisma.userScore.updateMany({
      where: { userId, month, year, monthPoints: { lt: 0 } },
      data:  { monthPoints: 0 },
    });
  }

  return checkBadges(userId, companyId);
}

// ─── addScoreOnce ─────────────────────────────────────────────────────────────

/**
 * Versão idempotente de addScore: só cria o evento se ainda não houver um com
 * o mesmo (userId, reason, referenceId). Use para ações que podem se repetir
 * (reabrir/fechar ticket, alternar lead status) sem duplicar pontos.
 */
export async function addScoreOnce(
  userId:      string,
  companyId:   string,
  reason:      ScoreReason,
  referenceId: string,
): Promise<{ badge: BadgeType; tier: number }[]> {
  const existing = await prisma.scoreEvent.findFirst({
    where: { userId, reason, referenceId },
    select: { id: true },
  });
  if (existing) return [];
  return addScore(userId, companyId, reason, referenceId);
}

// ─── revertScore ──────────────────────────────────────────────────────────────

/**
 * Remove os ScoreEvents relacionados a uma referência (ex: ticket ou lead
 * deletado) e ajusta o UserScore. Badges já conquistadas NÃO são removidas
 * (você não perde uma conquista — só os pontos retornam).
 */
export async function revertScore(
  userId:      string,
  companyId:   string,
  referenceId: string,
  reason?:     ScoreReason,
): Promise<void> {
  const where = { userId, companyId, referenceId, ...(reason ? { reason } : {}) };
  const events = await prisma.scoreEvent.findMany({
    where,
    select: { id: true, points: true, createdAt: true },
  });
  if (events.length === 0) return;

  for (const ev of events) {
    const m = ev.createdAt.getMonth() + 1;
    const y = ev.createdAt.getFullYear();
    await prisma.$transaction([
      prisma.scoreEvent.delete({ where: { id: ev.id } }),
      prisma.userScore.updateMany({
        where: { userId, month: m, year: y },
        data: {
          monthPoints: { decrement: ev.points },
          totalPoints: { decrement: ev.points },
        },
      }),
    ]);
  }

  // Garante que monthPoints/totalPoints não fiquem negativos
  await prisma.userScore.updateMany({
    where: { userId, OR: [{ monthPoints: { lt: 0 } }, { totalPoints: { lt: 0 } }] },
    data:  { monthPoints: 0 },
  });
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

// ─── syncProjectTasks ─────────────────────────────────────────────────────────

/**
 * Compara o estado atual das tarefas (vindas do ClickUp) com o snapshot
 * armazenado em ProjectTaskState e:
 *
 *  1. Atualiza counts agregados (taskCount, completed, overdue, noDueDate)
 *  2. Detecta criações, atualizações e conclusões → cria ProjectActivity
 *  3. Pontua os membros do projeto via addScore
 *  4. Atualiza ProjectTaskState com os valores novos
 *
 * Primeira sync: NÃO gera atividades nem pontos (só estabelece baseline).
 */
export async function syncProjectTasks(
  projectId: string,
  tasks:     Array<{ id: string; name: string; statusName: string | null; isCompleted: boolean; dueDate: number | null; dateUpdated: number | null }>,
): Promise<{ created: number; updated: number; completed: number }> {
  const project = await prisma.setorClickupList.findUnique({
    where: { id: projectId },
    include: {
      members: { select: { userId: true } },
      setor:   { select: { companyId: true } },
    },
  });
  if (!project) return { created: 0, updated: 0, completed: 0 };

  const companyId = project.setor.companyId;
  const memberIds = project.members.map((m) => m.userId);
  const isPaused  = project.status === "AGUARDANDO_CLIENTE"
                 || project.status === "ENTREGUE"
                 || project.status === "CANCELADO";

  // Snapshot atual em DB
  const stored = await prisma.projectTaskState.findMany({
    where: { projectId },
  });
  const isFirstSync = stored.length === 0;
  const storedById = new Map(stored.map((s) => [s.taskId, s]));

  // Atualiza agregados
  const now = Date.now();
  let taskCount = 0, taskCompleted = 0, taskOverdue = 0, taskNoDueDate = 0;
  for (const t of tasks) {
    taskCount++;
    if (t.isCompleted) taskCompleted++;
    else if (t.dueDate && t.dueDate < now) taskOverdue++;
    else if (!t.dueDate) taskNoDueDate++;
  }

  await prisma.setorClickupList.update({
    where: { id: projectId },
    data:  { taskCount, taskCompleted, taskOverdue, taskNoDueDate, lastSyncedAt: new Date() },
  });

  let created = 0, updated = 0, completed = 0;
  const activitiesToInsert: Array<{ type: string; taskName: string; taskId: string }> = [];

  for (const t of tasks) {
    const prev = storedById.get(t.id);

    if (!prev) {
      // Tarefa nova
      if (!isFirstSync && !isPaused) {
        activitiesToInsert.push({ type: "TASK_CREATED", taskName: t.name, taskId: t.id });
        for (const uid of memberIds) {
          void addScore(uid, companyId, ScoreReason.TAREFA_CRIADA, `${projectId}:${t.id}:CREATED`).catch(() => {});
        }
        created++;
      }
    } else {
      // Tarefa virou concluída
      if (!prev.isCompleted && t.isCompleted) {
        if (!isFirstSync && !isPaused) {
          activitiesToInsert.push({ type: "TASK_COMPLETED", taskName: t.name, taskId: t.id });
          for (const uid of memberIds) {
            void addScore(uid, companyId, ScoreReason.TAREFA_CONCLUIDA, `${projectId}:${t.id}:COMPLETED`).catch(() => {});
          }
          completed++;
        }
      }
      // Atualização (date_updated mudou) — só conta se não for a transição pra concluída
      else if (
        prev.dateUpdated && t.dateUpdated &&
        Number(prev.dateUpdated) < t.dateUpdated &&
        !isFirstSync && !isPaused
      ) {
        activitiesToInsert.push({ type: "TASK_UPDATED", taskName: t.name, taskId: t.id });
        // Idempotência por timestamp — referenceId inclui o dateUpdated
        for (const uid of memberIds) {
          void addScore(uid, companyId, ScoreReason.TAREFA_ATUALIZADA, `${projectId}:${t.id}:${t.dateUpdated}`).catch(() => {});
        }
        updated++;
      }
    }
  }

  // Atualiza snapshot (upsert por task)
  for (const t of tasks) {
    await prisma.projectTaskState.upsert({
      where: { projectId_taskId: { projectId, taskId: t.id } },
      create: {
        projectId,
        taskId:      t.id,
        name:        t.name,
        statusName:  t.statusName,
        isCompleted: t.isCompleted,
        dateUpdated: t.dateUpdated ? BigInt(t.dateUpdated) : null,
      },
      update: {
        name:        t.name,
        statusName:  t.statusName,
        isCompleted: t.isCompleted,
        dateUpdated: t.dateUpdated ? BigInt(t.dateUpdated) : null,
      },
    });
  }

  // Remove states de tarefas que não existem mais
  const currentIds = new Set(tasks.map((t) => t.id));
  const orphans = stored.filter((s) => !currentIds.has(s.taskId));
  if (orphans.length > 0) {
    await prisma.projectTaskState.deleteMany({
      where: { id: { in: orphans.map((o) => o.id) } },
    });
  }

  // Insere atividades
  if (activitiesToInsert.length > 0) {
    await prisma.projectActivity.createMany({
      data: activitiesToInsert.map((a) => ({ projectId, ...a })),
    });
  }

  return { created, updated, completed };
}

// ─── runProjectsDailyPenalties ────────────────────────────────────────────────

/**
 * Penalidade diária por projeto que tem tarefas SEM due_date no ClickUp.
 *
 * Aplica -3 pts pra cada membro do projeto, idempotente por (projeto, dia).
 * Roda como parte do cron daily da gamificação. Para de aplicar quando o
 * pessoal preenche os prazos no ClickUp.
 */
export async function runProjectsDailyPenalties(companyId: string): Promise<void> {
  const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));

  const projects = await prisma.setorClickupList.findMany({
    where: {
      taskNoDueDate: { gt: 0 },
      // AGUARDANDO_CLIENTE pausa penalidades (depende do cliente, não da equipe)
      status: { notIn: ["ENTREGUE", "CANCELADO", "AGUARDANDO_CLIENTE"] },
      setor: { companyId },
    },
    include: {
      members: { select: { userId: true } },
    },
  });

  for (const proj of projects) {
    if (proj.members.length === 0) continue; // sem ninguém pra penalizar

    for (const m of proj.members) {
      const alreadyToday = await prisma.scoreEvent.findFirst({
        where: {
          userId:      m.userId,
          companyId,
          reason:      ScoreReason.TAREFA_SEM_PRAZO,
          referenceId: proj.id,
          createdAt:   { gte: startOfDay },
        },
      });
      if (alreadyToday) continue;

      await addScore(m.userId, companyId, ScoreReason.TAREFA_SEM_PRAZO, proj.id);
    }
  }
}

// ─── runDiaSemAtraso ──────────────────────────────────────────────────────────

/**
 * No fim do expediente: para cada usuário ativo, se ele NÃO tem nenhum item
 * com prazo vencido (ticket.dueDate, conversation.scheduledReturnAt ou
 * lead.expectedReturnAt < agora) E tinha pelo menos 1 item ativo durante o
 * dia, recebe DIA_SEM_ATRASO (+15 pts).
 *
 * Idempotente por (userId, dia) — só fica uma vez por dia.
 */
export async function runDiaSemAtraso(companyId: string): Promise<void> {
  const now = new Date();
  const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));

  // Coleta todos os usuários da empresa que têm itens (assignee de algo)
  const [ticketAssignees, convAssignees] = await Promise.all([
    prisma.ticket.findMany({
      where:  { companyId, assigneeId: { not: null } },
      select: { assigneeId: true },
      distinct: ["assigneeId"],
    }),
    prisma.conversation.findMany({
      where:  { companyId, assigneeId: { not: null } },
      select: { assigneeId: true },
      distinct: ["assigneeId"],
    }),
  ]);
  const userIds = new Set<string>();
  for (const t of ticketAssignees)  if (t.assigneeId) userIds.add(t.assigneeId);
  for (const c of convAssignees)     if (c.assigneeId) userIds.add(c.assigneeId);

  for (const userId of userIds) {
    // Já recebeu DIA_SEM_ATRASO hoje? Skip.
    const alreadyToday = await prisma.scoreEvent.findFirst({
      where: {
        userId,
        companyId,
        reason:    ScoreReason.DIA_SEM_ATRASO,
        createdAt: { gte: startOfDay },
      },
    });
    if (alreadyToday) continue;

    // Conta itens vencidos do usuário
    const [overdueTickets, overdueConvs, overdueLeads] = await Promise.all([
      prisma.ticket.count({
        where: {
          companyId, assigneeId: userId,
          status: { in: ["OPEN", "IN_PROGRESS"] },
          dueDate: { lt: now },
        },
      }),
      prisma.conversation.count({
        where: {
          companyId, assigneeId: userId,
          status: { not: "CLOSED" },
          scheduledReturnAt: { lt: now },
        },
      }),
      prisma.lead.count({
        where: {
          companyId,
          status: { notIn: ["CLOSED", "LOST"] },
          expectedReturnAt: { lt: now },
          // O Lead model não tem assigneeId — usamos a Conversation associada.
          // Um lead "do usuário" é o que está vinculado a uma conversa atribuída a ele.
          conversation: { assigneeId: userId },
        },
      }),
    ]);

    if (overdueTickets + overdueConvs + overdueLeads > 0) continue;

    // Confirma que tinha pelo menos 1 item ativo (evita ganhar pontos por ser fantasma)
    const hasActive = await prisma.ticket.count({
      where: { companyId, assigneeId: userId, status: { in: ["OPEN", "IN_PROGRESS", "RESOLVED"] } },
    }) + await prisma.conversation.count({
      where: { companyId, assigneeId: userId },
    });

    if (hasActive === 0) continue;

    await addScore(userId, companyId, ScoreReason.DIA_SEM_ATRASO);
  }
}

// ─── getRanking ───────────────────────────────────────────────────────────────

export type RankingEntry = {
  userId:          string;
  name:            string;
  rankingCategory: "PRODUCAO" | "GESTAO";
  monthPoints:     number;
  totalPoints:     number;
  position:        number;
  // Maior tier conquistado por badge (não duplica entradas do mesmo badge)
  badges:          { badge: BadgeType; tier: number }[];
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
    include: { user: { select: { id: true, name: true, rankingCategory: true } } },
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

  // Posições por categoria — cada categoria tem seu próprio 1º, 2º, 3º.
  const posByCategory: Record<string, number> = { PRODUCAO: 0, GESTAO: 0 };
  return scores.map((s) => {
    const cat = s.user.rankingCategory;
    posByCategory[cat]++;
    return {
      userId:          s.userId,
      name:            s.user.name,
      rankingCategory: cat,
      monthPoints:     s.monthPoints,
      totalPoints:     s.totalPoints,
      position:        posByCategory[cat],
      badges:          (badgesByUser[s.userId] ?? []).sort((a, b) => b.tier - a.tier),
    };
  });
}
