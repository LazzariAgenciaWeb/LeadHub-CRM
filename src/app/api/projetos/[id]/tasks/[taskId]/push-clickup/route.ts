import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getClickupSettings, createClickupTask } from "@/lib/clickup";

// POST /api/projetos/[id]/tasks/[taskId]/push-clickup
// Pega uma tarefa NATIVA (sem vínculo) e a cria no ClickUp, amarrando o
// clickupTaskId — a partir daí ela entra no sync bidirecional. Idempotente:
// se já está vinculada, não faz nada.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id, taskId } = await params;
  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const task = await prisma.projectTask.findUnique({
    where:   { id: taskId },
    include: { project: { include: { setor: { select: { companyId: true } } } } },
  });
  if (!task || task.projectId !== id) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && task.project.setor.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  if (task.clickupTaskId) {
    return NextResponse.json({ ok: true, alreadyLinked: true, clickupTaskId: task.clickupTaskId });
  }
  if (!task.project.clickupListId) {
    return NextResponse.json({ error: "Projeto sem lista do ClickUp — não dá pra sincronizar." }, { status: 400 });
  }

  const settings = await getClickupSettings(task.project.setor.companyId);
  if (!settings?.apiToken) {
    return NextResponse.json({ error: "ClickUp não configurado pra essa empresa." }, { status: 503 });
  }

  const newTaskId = await createClickupTask({
    apiToken:    settings.apiToken,
    listId:      task.project.clickupListId,
    name:        task.title,
    description: task.description ?? undefined,
    priority:    task.priority,
    dueDate:     task.dueDate ? task.dueDate.getTime() : undefined,
    tags:        ["projeto"],
  });
  if (!newTaskId) {
    return NextResponse.json({ error: "Falha ao criar a tarefa no ClickUp." }, { status: 502 });
  }

  // Amarra o vínculo + semeia o snapshot (evita duplicar no próximo sync).
  await prisma.projectTask.update({ where: { id: taskId }, data: { clickupTaskId: newTaskId } });
  await prisma.projectTaskState.upsert({
    where:  { projectId_taskId: { projectId: id, taskId: newTaskId } },
    create: {
      projectId: id, taskId: newTaskId, name: task.title,
      isCompleted: task.done, hasNoAssignee: !task.assigneeId,
      dueDate: task.dueDate ? BigInt(task.dueDate.getTime()) : null,
      startDate: task.startDate ? BigInt(task.startDate.getTime()) : null,
    },
    update: {},
  }).catch(() => {});

  return NextResponse.json({ ok: true, clickupTaskId: newTaskId });
}
