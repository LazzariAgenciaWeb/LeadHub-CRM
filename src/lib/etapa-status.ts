import { prisma } from "@/lib/prisma";

/**
 * Etapa concluída que volta a ter trabalho (tarefa nova entrou nela, ou uma
 * tarefa dela foi reaberta) reabre sozinha — senão a tarefa sumiria da vista
 * "Tudo/Em andamento" junto com a etapa. No-op se a etapa já está aberta.
 */
export async function reopenEtapaIfCompleted(stepId: string | null | undefined): Promise<void> {
  if (!stepId) return;
  await prisma.projectService.updateMany({
    where: { id: stepId, completedAt: { not: null } },
    data:  { completedAt: null },
  }).catch(() => {});
}
