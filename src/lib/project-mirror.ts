import { prisma } from "@/lib/prisma";
import type { ClickupTaskLite } from "@/lib/clickup";

/**
 * Espelha as tarefas de uma lista do ClickUp como tarefas NATIVAS (ProjectTask)
 * do projeto — pra TUDO do ClickUp existir dentro do LeadHub, sem import manual
 * tarefa a tarefa. Cada tarefa nova entra:
 *   - `clickupTaskId` setado → engata no sync bidirecional que já existe
 *     (título/prazo/descritivo/conclusão/comentários);
 *   - `visibleToClient = false` → oculta por padrão; você decide quando mostrar;
 *   - `projectServiceId` = a etapa, quando a tarefa é SUBTAREFA de uma tarefa
 *     principal já vinculada a uma etapa. Senão null → cai em "A organizar".
 *
 * A hierarquia é o ponto: no ClickUp a tarefa principal é a etapa (o mês) e as
 * subtarefas são o que se executa. Antes o `parent` era descartado e mãe e
 * filhas caíam achatadas em "A organizar"; agora filha de etapa já nasce dentro
 * dela, e a própria tarefa-etapa não é espelhada como tarefa (ela É a etapa).
 *
 * Idempotente: só cria as tarefas do ClickUp que ainda não têm ProjectTask
 * vinculada. Não mexe nas já existentes (o sync cuida da atualização delas).
 * Retorna quantas foram criadas.
 */
export async function mirrorClickupTasks(
  projectId: string,
  tasks: ClickupTaskLite[],
): Promise<number> {
  if (!tasks?.length) return 0;

  const [existing, etapas] = await Promise.all([
    prisma.projectTask.findMany({
      where:  { projectId, clickupTaskId: { not: null } },
      select: { clickupTaskId: true },
    }),
    prisma.projectService.findMany({
      where:  { projectId, clickupTaskId: { not: null } },
      select: { id: true, clickupTaskId: true, name: true, service: { select: { name: true } } },
    }),
  ]);
  const linked = new Set(existing.map((t) => t.clickupTaskId));

  // ClickUp task id da tarefa principal → etapa correspondente no LeadHub.
  const etapaByClickupId = new Map(etapas.map((e) => [e.clickupTaskId!, e]));

  const toCreate = tasks.filter((t) => t.id && !linked.has(t.id) && !etapaByClickupId.has(t.id));
  if (!toCreate.length) return 0;

  await prisma.projectTask.createMany({
    data: toCreate.map((t) => {
      const etapa = t.parentId ? etapaByClickupId.get(t.parentId) : undefined;
      return {
        projectId,
        title:            (t.name || "Tarefa").trim().slice(0, 500) || "Tarefa",
        clickupTaskId:    t.id,
        done:             !!t.isCompleted,
        completedAt:      t.isCompleted ? new Date() : null,
        dueDate:          t.dueDate   != null ? new Date(t.dueDate)   : null,
        startDate:        t.startDate != null ? new Date(t.startDate) : null,
        visibleToClient:  false,
        projectServiceId: etapa?.id ?? null,
        // A tela espelha o nome da etapa no chip `stage` — mantém o rótulo igual.
        stage: etapa ? ((etapa.name || etapa.service?.name || "").slice(0, 80) || null) : null,
      };
    }),
  });

  return toCreate.length;
}
