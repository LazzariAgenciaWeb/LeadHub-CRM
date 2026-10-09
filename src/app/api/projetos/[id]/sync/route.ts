import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, fetchClickupTasks } from "@/lib/clickup";
import { pullClickupIntoTask, LINKED_TASK_SELECT } from "@/lib/project-task-pull";
import { syncProjectTasks } from "@/lib/gamification";
import { mirrorClickupTasks } from "@/lib/project-mirror";
import { assertModule } from "@/lib/billing";

// POST /api/projetos/[id]/sync — sync manual de UM projeto
// Requer sessão (não usa CRON_SECRET, pra permitir o botão "Sync" no detail).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const { id } = await params;
  const project = await prisma.setorClickupList.findUnique({
    where:   { id },
    include: { setor: { select: { companyId: true } } },
  });
  if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && project.setor.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  if (!project.clickupListId) {
    return NextResponse.json({ error: "Projeto sem lista do ClickUp — nada pra sincronizar" }, { status: 400 });
  }

  const settings = await getClickupSettings(project.setor.companyId);
  if (!settings?.apiToken) {
    return NextResponse.json({ error: "ClickUp não configurado pra essa empresa" }, { status: 503 });
  }

  const tasks = await fetchClickupTasks(settings.apiToken, project.clickupListId);
  if (!tasks) {
    return NextResponse.json({
      error: "Não foi possível buscar tarefas do ClickUp. Cheque se o List ID está correto e o token tem acesso."
    }, { status: 502 });
  }

  const result = await syncProjectTasks(id, tasks);

  // Espelho automático: toda tarefa do ClickUp vira ProjectTask nativa (oculta +
  // sem serviço → cai na Caixa de entrada). Roda ANTES da Fase 2 pra as recém
  // criadas já entrarem no loop e receberem descritivo/comentários nesta sync.
  const mirrored = await mirrorClickupTasks(id, tasks);

  // Fase 2 (ClickUp → interna): reflete título/prazo/concluído nas tarefas
  // internas VINCULADAS (importadas/espelhadas). Não cria novas — só atualiza.
  const linked = await prisma.projectTask.findMany({
    where:  { projectId: id, clickupTaskId: { not: null } },
    select: LINKED_TASK_SELECT,
  });
  if (linked.length) {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (const lt of linked) {
      const src = byId.get(lt.clickupTaskId!);
      if (src) await pullClickupIntoTask(settings.apiToken, lt, src);
    }
  }

  return NextResponse.json({
    ok: true,
    tasksFound: tasks.length,
    mirrored, // quantas tarefas do ClickUp viraram tarefas nativas nesta sync
    activities: result,
    syncedAt: new Date().toISOString(),
  });
}
