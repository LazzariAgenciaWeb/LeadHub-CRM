import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getViewer, canSeeProject } from "@/lib/visibility";

// POST /api/projetos/[id]/tasks/import-clickup
// Body: { taskId }  (ID da tarefa no ClickUp — vem do snapshot ProjectTaskState)
//
// Cria uma tarefa INTERNA (ProjectTask) espelhando a tarefa do ClickUp e guarda
// o vínculo (clickupTaskId). Idempotente: se já importada, devolve a existente.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const userId        = (session.user as any).id as string | undefined;

  const project = await prisma.setorClickupList.findUnique({
    where: { id },
    include: {
      setor:       { select: { companyId: true } },
      members:     { select: { userId: true } },
      accessUsers: { select: { userId: true } },
    },
  });
  if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && project.setor.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  const viewer = await getViewer(session);
  if (!canSeeProject(viewer, {
    visibility: project.visibility,
    setorId: project.setorId,
    memberIds: project.members.map((m) => m.userId),
    accessUserIds: project.accessUsers.map((a) => a.userId),
  })) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const taskId = String(body?.taskId ?? "").trim();
  if (!taskId) return NextResponse.json({ error: "taskId é obrigatório" }, { status: 400 });

  // Já importada? devolve a interna existente (não duplica).
  const existing = await prisma.projectTask.findFirst({
    where: { projectId: id, clickupTaskId: taskId },
    include: { assignee: { select: { id: true, name: true } } },
  });
  if (existing) return NextResponse.json({ ok: true, already: true, task: existing });

  // Pega o snapshot da tarefa do ClickUp pra copiar nome/prazo/status.
  const state = await prisma.projectTaskState.findUnique({
    where: { projectId_taskId: { projectId: id, taskId } },
    select: { name: true, isCompleted: true, dueDate: true },
  });
  if (!state) return NextResponse.json({ error: "Tarefa do ClickUp não encontrada no snapshot. Rode o Sync." }, { status: 404 });

  const due = state.dueDate != null ? new Date(Number(state.dueDate)) : null;

  const task = await prisma.projectTask.create({
    data: {
      projectId:     id,
      title:         state.name,
      done:          state.isCompleted,
      dueDate:       due && !Number.isNaN(due.getTime()) ? due : null,
      clickupTaskId: taskId,
      createdById:   userId ?? null,
    },
    include: { assignee: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ ok: true, task }, { status: 201 });
}
