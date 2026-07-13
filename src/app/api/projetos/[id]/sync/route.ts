import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, fetchClickupTasks, fetchClickupTaskDescription } from "@/lib/clickup";
import { syncProjectTasks } from "@/lib/gamification";
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

  // Fase 2 (ClickUp → interna): reflete título/prazo/concluído nas tarefas
  // internas VINCULADAS (importadas). Não cria novas — só atualiza as ligadas.
  const linked = await prisma.projectTask.findMany({
    where:  { projectId: id, clickupTaskId: { not: null } },
    select: { id: true, clickupTaskId: true },
  });
  if (linked.length) {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (const lt of linked) {
      const src = byId.get(lt.clickupTaskId!);
      if (!src) continue;
      // Puxa o descritivo atualizado do ClickUp (best-effort, 1 chamada por tarefa
      // vinculada). Só sobrescreve quando vem conteúdo — não apaga o descritivo
      // interno se o do ClickUp estiver vazio.
      let desc: string | null = null;
      try { desc = (await fetchClickupTaskDescription(settings.apiToken, lt.clickupTaskId!)) || null; } catch { /* silencioso */ }
      await prisma.projectTask.update({
        where: { id: lt.id },
        data: {
          ...(src.name ? { title: src.name } : {}),
          ...(desc ? { description: desc } : {}),
          done: src.isCompleted,
          completedAt: src.isCompleted ? new Date() : null,
          dueDate: src.dueDate != null ? new Date(src.dueDate) : null,
        },
      }).catch(() => {});
    }
  }

  return NextResponse.json({
    ok: true,
    tasksFound: tasks.length,
    activities: result,
    syncedAt: new Date().toISOString(),
  });
}
