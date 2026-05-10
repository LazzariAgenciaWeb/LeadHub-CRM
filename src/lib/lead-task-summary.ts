import { prisma } from "./prisma";

export interface LeadTaskSummary {
  openCount: number;
  nextDueAt: string | null;
}

/**
 * Para um conjunto de leadIds, retorna mapa { leadId → { openCount, nextDueAt } }
 * considerando apenas tarefas em aberto (`done=false`). Próxima `dueAt` é a mínima.
 *
 * Usa groupBy para fazer o trabalho em uma query só — não puxa as tarefas em si.
 */
export async function getLeadTaskSummaries(
  leadIds: string[]
): Promise<Record<string, LeadTaskSummary>> {
  if (leadIds.length === 0) return {};

  const grouped = await prisma.task.groupBy({
    by: ["leadId"],
    where: { leadId: { in: leadIds }, done: false },
    _count: { _all: true },
    _min: { dueAt: true },
  });

  const map: Record<string, LeadTaskSummary> = {};
  for (const row of grouped) {
    map[row.leadId] = {
      openCount: row._count._all,
      nextDueAt: row._min.dueAt ? row._min.dueAt.toISOString() : null,
    };
  }
  return map;
}

/** Anexa o resumo às tarefas em uma lista de leads, retornando uma nova array. */
export async function attachTaskSummaries<T extends { id: string }>(
  leads: T[]
): Promise<(T & { taskSummary: LeadTaskSummary })[]> {
  const map = await getLeadTaskSummaries(leads.map((l) => l.id));
  return leads.map((l) => ({
    ...l,
    taskSummary: map[l.id] ?? { openCount: 0, nextDueAt: null },
  }));
}

/** Map { leadId → openCount } pra alimentar o lead scoring sem refetchar. */
export function openTaskCountMap<T extends { id: string; taskSummary?: LeadTaskSummary }>(
  leads: T[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of leads) out[l.id] = l.taskSummary?.openCount ?? 0;
  return out;
}
