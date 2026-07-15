import { prisma } from "@/lib/prisma";
import type { ClickupTaskLite } from "@/lib/clickup";

/**
 * Espelha as tarefas de uma lista do ClickUp como tarefas NATIVAS (ProjectTask)
 * do projeto — pra TUDO do ClickUp existir dentro do LeadHub, sem import manual
 * tarefa a tarefa. Cada tarefa nova entra:
 *   - `clickupTaskId` setado → engata no sync bidirecional que já existe
 *     (título/prazo/descritivo/conclusão/comentários);
 *   - `visibleToClient = false` → oculta por padrão; você decide quando mostrar;
 *   - `projectServiceId = null` → cai na "Caixa de entrada / a organizar" do
 *     projeto (não polui os serviços). Você atribui a um serviço 1× e ela sai.
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

  const existing = await prisma.projectTask.findMany({
    where:  { projectId, clickupTaskId: { not: null } },
    select: { clickupTaskId: true },
  });
  const linked = new Set(existing.map((t) => t.clickupTaskId));

  const toCreate = tasks.filter((t) => t.id && !linked.has(t.id));
  if (!toCreate.length) return 0;

  await prisma.projectTask.createMany({
    data: toCreate.map((t) => ({
      projectId,
      title:           (t.name || "Tarefa").trim().slice(0, 500) || "Tarefa",
      clickupTaskId:   t.id,
      done:            !!t.isCompleted,
      completedAt:     t.isCompleted ? new Date() : null,
      dueDate:         t.dueDate   != null ? new Date(t.dueDate)   : null,
      startDate:       t.startDate != null ? new Date(t.startDate) : null,
      visibleToClient: false,
    })),
  });

  return toCreate.length;
}
