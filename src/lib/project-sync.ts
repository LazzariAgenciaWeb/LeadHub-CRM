import { prisma } from "@/lib/prisma";
import { getClickupSettings, fetchClickupTasks } from "@/lib/clickup";
import { pullClickupIntoTask, LINKED_TASK_SELECT } from "@/lib/project-task-pull";
import { syncProjectTasks } from "@/lib/gamification";
import { mirrorClickupTasks } from "@/lib/project-mirror";

/**
 * Puxa a lista do ClickUp pra dentro do projeto — é o que o botão "Atualizar"
 * da tela do projeto faz, e agora também o assistente.
 *
 * Três fases, nesta ordem:
 *   1. syncProjectTasks  — snapshot, agregados, atividades e pontuação. É aqui
 *      que o `parentTaskId` de cada tarefa entra, que é o que amarra a
 *      subtarefa à tarefa principal (a etapa).
 *   2. mirrorClickupTasks — toda tarefa do ClickUp vira ProjectTask nativa.
 *      Roda ANTES da fase 3 pra a recém-criada já receber descritivo e
 *      comentários nesta mesma passada.
 *   3. pullClickupIntoTask — reflete título/prazo/conclusão nas tarefas já
 *      vinculadas. Não cria nada, só atualiza.
 *
 * Nunca lança: devolve `ok: false` com um motivo que dá pra mostrar ao usuário.
 * Quem chama trata permissão ANTES — esta função não conhece sessão.
 */
export type ProjectSyncResult =
  | {
      ok: true;
      projectId: string;
      projectName: string;
      tasksFound: number;
      /** Quantas tarefas do ClickUp viraram tarefa nativa agora. */
      mirrored: number;
      /** Quantas tarefas já vinculadas foram atualizadas pelo pull. */
      atualizadas: number;
      activities: { created: number; updated: number; completed: number };
      syncedAt: string;
    }
  | {
      ok: false;
      code: "SEM_PROJETO" | "SEM_LISTA" | "SEM_TOKEN" | "FALHA_CLICKUP";
      reason: string;
    };

export async function syncProjectFromClickup(projectId: string): Promise<ProjectSyncResult> {
  const project = await prisma.setorClickupList.findUnique({
    where:  { id: projectId },
    select: { id: true, name: true, clickupListId: true, setor: { select: { companyId: true } } },
  });
  if (!project) {
    return { ok: false, code: "SEM_PROJETO", reason: "Projeto não encontrado." };
  }
  if (!project.clickupListId) {
    return {
      ok: false,
      code: "SEM_LISTA",
      reason: `O projeto "${project.name}" não tem lista do ClickUp vinculada — não há o que sincronizar. Vincule uma lista na tela do projeto.`,
    };
  }

  const settings = await getClickupSettings(project.setor.companyId);
  if (!settings?.apiToken) {
    return { ok: false, code: "SEM_TOKEN", reason: "ClickUp não configurado pra essa empresa." };
  }

  const tasks = await fetchClickupTasks(settings.apiToken, project.clickupListId);
  if (!tasks) {
    return {
      ok: false,
      code: "FALHA_CLICKUP",
      reason: "Não foi possível buscar as tarefas no ClickUp. Cheque se o List ID está correto e se o token tem acesso.",
    };
  }

  const activities = await syncProjectTasks(project.id, tasks);
  const mirrored   = await mirrorClickupTasks(project.id, tasks);

  const linked = await prisma.projectTask.findMany({
    where:  { projectId: project.id, clickupTaskId: { not: null } },
    select: LINKED_TASK_SELECT,
  });
  let atualizadas = 0;
  if (linked.length) {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (const lt of linked) {
      const src = byId.get(lt.clickupTaskId!);
      if (!src) continue;
      await pullClickupIntoTask(settings.apiToken, lt, src);
      atualizadas++;
    }
  }

  return {
    ok: true,
    projectId:   project.id,
    projectName: project.name,
    tasksFound:  tasks.length,
    mirrored,
    atualizadas,
    activities,
    syncedAt: new Date().toISOString(),
  };
}
