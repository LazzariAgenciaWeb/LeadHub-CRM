import { prisma } from "@/lib/prisma";
import { getClickupSettings, createClickupTask } from "@/lib/clickup";

/**
 * Etapas de projeto ↔ tarefas principais do ClickUp.
 *
 * O jeito de trabalhar que isto atende: no ClickUp a lista é o projeto, a tarefa
 * PRINCIPAL é a etapa (o mês, por exemplo) e as SUBTAREFAS são o que precisa ser
 * executado. Aqui a etapa é um `ProjectService` e passa a guardar o id da tarefa
 * principal (`clickupTaskId`) — então:
 *
 *   - criar etapa no LeadHub cria a tarefa principal no ClickUp (nome igual);
 *   - tarefa criada dentro da etapa sobe como SUBTAREFA dela, não solta na raiz;
 *   - subtarefa que desce do ClickUp já cai dentro da etapa, não em "A organizar".
 *
 * Projeto sem lista do ClickUp segue 100% local: a etapa nasce sem
 * `clickupTaskId` e nada aqui reclama.
 */

export type EtapaLite = {
  id: string;
  name: string | null;
  serviceId: string | null;
  order: number;
  clickupTaskId: string | null;
  service?: { name: string } | null;
};

/** Rótulo visível da etapa: o `name` manda; sem ele, o nome do serviço. */
export function etapaLabel(e: { name?: string | null; service?: { name: string } | null }): string {
  return (e.name || e.service?.name || "").trim() || "Serviço";
}

/** Normaliza pra comparar nome de etapa: sem caixa, sem espaço nas pontas. */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

const ETAPA_SELECT = {
  id: true, name: true, serviceId: true, order: true, clickupTaskId: true,
  service: { select: { name: true } },
} as const;

/** Etapas do projeto na ordem, com contagem de tarefas abertas e concluídas. */
export async function listEtapas(projectId: string) {
  const [etapas, counts] = await Promise.all([
    prisma.projectService.findMany({
      where: { projectId }, orderBy: { order: "asc" }, select: ETAPA_SELECT,
    }),
    prisma.projectTask.groupBy({
      by: ["projectServiceId", "done"],
      where: { projectId, projectServiceId: { not: null }, ignoredAt: null },
      _count: { _all: true },
    }),
  ]);

  const abertas = new Map<string, number>();
  const feitas  = new Map<string, number>();
  for (const c of counts) {
    const key = c.projectServiceId!;
    (c.done ? feitas : abertas).set(key, c._count._all);
  }

  return etapas.map((e) => ({
    ...e,
    label:   etapaLabel(e),
    abertas: abertas.get(e.id) ?? 0,
    feitas:  feitas.get(e.id) ?? 0,
  }));
}

/**
 * Cria a tarefa principal no ClickUp pra uma etapa que ainda não tem.
 * Retorna o id criado, ou null quando não há o que fazer (projeto sem lista,
 * ClickUp não configurado) ou quando a chamada falhou — nunca lança: etapa sem
 * espelho no ClickUp é um estado válido, não um erro de criação de etapa.
 */
export async function ensureEtapaClickupTask(etapaId: string): Promise<string | null> {
  const etapa = await prisma.projectService.findUnique({
    where: { id: etapaId },
    select: {
      ...ETAPA_SELECT,
      project: { select: { clickupListId: true, setor: { select: { companyId: true } } } },
    },
  });
  if (!etapa) return null;
  if (etapa.clickupTaskId) return etapa.clickupTaskId;

  const listId = etapa.project.clickupListId;
  if (!listId) return null;

  const settings = await getClickupSettings(etapa.project.setor.companyId);
  if (!settings?.apiToken) return null;

  const taskId = await createClickupTask({
    apiToken: settings.apiToken,
    listId,
    name:     etapaLabel(etapa),
    tags:     ["etapa"],
  });
  if (!taskId) return null;

  await prisma.projectService.update({ where: { id: etapaId }, data: { clickupTaskId: taskId } });
  return taskId;
}

/**
 * Cria uma etapa no projeto. IDEMPOTENTE pelo rótulo: etapa com o mesmo nome
 * (ignorando caixa e espaços) devolve a existente em vez de duplicar — criar
 * "Novembro/2026" duas vezes é sempre engano, nunca intenção.
 *
 * `order` omitida = última. Quando o projeto tem lista do ClickUp, a etapa nasce
 * com a tarefa principal lá.
 */
export async function createEtapa({
  projectId, serviceId = null, name = null, order,
}: {
  projectId: string;
  serviceId?: string | null;
  name?: string | null;
  order?: number;
}): Promise<{ etapa: EtapaLite & { label: string }; created: boolean }> {
  const existentes = await prisma.projectService.findMany({
    where: { projectId }, orderBy: { order: "asc" }, select: ETAPA_SELECT,
  });

  const alvo = name ? norm(name) : null;
  const ja = existentes.find((e) =>
    (serviceId && e.serviceId === serviceId && !name) ||
    (alvo !== null && norm(etapaLabel(e)) === alvo),
  );
  if (ja) return { etapa: { ...ja, label: etapaLabel(ja) }, created: false };

  const lastOrder = existentes.length ? existentes[existentes.length - 1].order : -1;
  const etapa = await prisma.projectService.create({
    data: {
      projectId,
      serviceId,
      name,
      order: Number.isFinite(order) ? Number(order) : lastOrder + 1,
    },
    select: ETAPA_SELECT,
  });

  const clickupTaskId = await ensureEtapaClickupTask(etapa.id).catch(() => null);
  return { etapa: { ...etapa, clickupTaskId, label: etapaLabel(etapa) }, created: true };
}

/**
 * Sobe uma tarefa NATIVA pro ClickUp. Se ela está numa etapa que tem tarefa
 * principal, nasce como SUBTAREFA dela — é o que evita a tarefa ficar solta na
 * raiz da lista. Idempotente: tarefa já vinculada não cria nada.
 *
 * Retorna o motivo quando não subiu, pra quem chamou poder contar ao usuário.
 */
export async function pushTaskToClickup(taskId: string): Promise<
  | { ok: true; clickupTaskId: string; parentTaskId: string | null; already?: boolean }
  | { ok: false; reason: string }
> {
  const task = await prisma.projectTask.findUnique({
    where: { id: taskId },
    select: {
      id: true, title: true, description: true, priority: true, dueDate: true, startDate: true,
      done: true, assigneeId: true, clickupTaskId: true, projectId: true,
      projectService: { select: { id: true, clickupTaskId: true } },
      project: { select: { clickupListId: true, setor: { select: { companyId: true } } } },
    },
  });
  if (!task) return { ok: false, reason: "Tarefa não encontrada." };
  if (task.clickupTaskId) {
    return { ok: true, clickupTaskId: task.clickupTaskId, parentTaskId: null, already: true };
  }

  const listId = task.project.clickupListId;
  if (!listId) return { ok: false, reason: "Projeto sem lista do ClickUp — não dá pra sincronizar." };

  const settings = await getClickupSettings(task.project.setor.companyId);
  if (!settings?.apiToken) return { ok: false, reason: "ClickUp não configurado pra essa empresa." };

  // Etapa sem tarefa principal ainda (etapa antiga, ou criada enquanto o ClickUp
  // estava fora do ar): cria agora, pra subtarefa ter onde se pendurar.
  let parent: string | null = task.projectService?.clickupTaskId ?? null;
  if (!parent && task.projectService) {
    parent = await ensureEtapaClickupTask(task.projectService.id).catch(() => null);
  }

  const newId = await createClickupTask({
    apiToken:    settings.apiToken,
    listId,
    name:        task.title,
    description: task.description ?? undefined,
    priority:    task.priority,
    dueDate:     task.dueDate ? task.dueDate.getTime() : undefined,
    tags:        ["projeto"],
    ...(parent ? { parent } : {}),
  });
  if (!newId) return { ok: false, reason: "Falha ao criar a tarefa no ClickUp." };

  await prisma.projectTask.update({ where: { id: task.id }, data: { clickupTaskId: newId } });
  // Semeia o snapshot pro próximo sync não ver a tarefa como "nova" e duplicar.
  await prisma.projectTaskState.upsert({
    where:  { projectId_taskId: { projectId: task.projectId, taskId: newId } },
    create: {
      projectId: task.projectId, taskId: newId, name: task.title,
      parentTaskId: parent,
      isCompleted: task.done, hasNoAssignee: !task.assigneeId,
      dueDate:   task.dueDate   ? BigInt(task.dueDate.getTime())   : null,
      startDate: task.startDate ? BigInt(task.startDate.getTime()) : null,
    },
    update: {},
  }).catch(() => {});

  return { ok: true, clickupTaskId: newId, parentTaskId: parent };
}

/**
 * Promove uma tarefa existente a ETAPA — o caso de arrumar o que já está lá:
 * você aponta qual tarefa é o mês e ela passa a ser a etapa, reusando a MESMA
 * tarefa do ClickUp (nada novo é criado lá) e levando as subtarefas pra dentro.
 *
 * A tarefa-mãe deixa de ser tarefa: é apagada, porque virou a etapa. Se tiver
 * anexos ou materiais pendurados nela, é só arquivada (`ignoredAt`) pra não
 * perder arquivo — o retorno diz qual dos dois aconteceu.
 */
export async function promoteTaskToEtapa(taskId: string): Promise<
  | { ok: true; etapaId: string; label: string; movidas: number; maeArquivada: boolean }
  | { ok: false; reason: string }
> {
  const task = await prisma.projectTask.findUnique({
    where: { id: taskId },
    select: {
      id: true, title: true, projectId: true, clickupTaskId: true, projectServiceId: true,
      _count: { select: { attachments: true, materials: true } },
    },
  });
  if (!task) return { ok: false, reason: "Tarefa não encontrada." };

  const { etapa, created } = await createEtapa({ projectId: task.projectId, name: task.title });
  if (!created && etapa.clickupTaskId && etapa.clickupTaskId !== task.clickupTaskId) {
    return { ok: false, reason: `Já existe a etapa "${etapa.label}" neste projeto, ligada a outra tarefa do ClickUp.` };
  }

  // A etapa reusa a tarefa do ClickUp que já existe — não cria outra lá.
  if (task.clickupTaskId && etapa.clickupTaskId !== task.clickupTaskId) {
    await prisma.projectService.update({
      where: { id: etapa.id },
      data:  { clickupTaskId: task.clickupTaskId },
    });
  }

  // Filhas: as tarefas do projeto cujo pai no ClickUp é esta tarefa.
  let movidas = 0;
  if (task.clickupTaskId) {
    const filhas = await prisma.projectTaskState.findMany({
      where:  { projectId: task.projectId, parentTaskId: task.clickupTaskId },
      select: { taskId: true },
    });
    const ids = filhas.map((f) => f.taskId);
    if (ids.length) {
      const r = await prisma.projectTask.updateMany({
        where: { projectId: task.projectId, clickupTaskId: { in: ids } },
        data:  { projectServiceId: etapa.id, stage: etapa.label.slice(0, 80) || null },
      });
      movidas = r.count;
    }
  }

  const temArquivo = task._count.attachments > 0 || task._count.materials > 0;
  if (temArquivo) {
    await prisma.projectTask.update({ where: { id: task.id }, data: { ignoredAt: new Date() } });
  } else {
    await prisma.projectTask.delete({ where: { id: task.id } });
  }

  return { ok: true, etapaId: etapa.id, label: etapa.label, movidas, maeArquivada: temArquivo };
}
