import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getViewer, canSeeProject } from "@/lib/visibility";
import { getClickupSettings, fetchClickupTaskDescription, fetchClickupTaskComments } from "@/lib/clickup";
import { sanitizeComments } from "@/lib/checklist";

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
  // Aceita 1 (taskId) ou vários (taskIds[]). Cap de 50 por chamada pra não
  // estourar rate limit do ClickUp (cada import faz 2 GETs: desc + comentários).
  const rawIds: string[] = Array.isArray(body?.taskIds)
    ? body.taskIds
    : (body?.taskId ? [body.taskId] : []);
  const taskIds = Array.from(new Set(rawIds.map((x) => String(x).trim()).filter(Boolean))).slice(0, 50);
  if (taskIds.length === 0) return NextResponse.json({ error: "taskId(s) obrigatório(s)" }, { status: 400 });

  const settings = await getClickupSettings(project.setor.companyId);

  const created: unknown[] = [];
  let alreadyCount = 0;
  let notFoundCount = 0;

  for (const taskId of taskIds) {
    // Já importada? não duplica.
    const existing = await prisma.projectTask.findFirst({
      where: { projectId: id, clickupTaskId: taskId },
      select: { id: true },
    });
    if (existing) { alreadyCount++; continue; }

    // Snapshot da tarefa (nome/prazo/status). Sem snapshot → pede Sync.
    const state = await prisma.projectTaskState.findUnique({
      where: { projectId_taskId: { projectId: id, taskId } },
      select: { name: true, isCompleted: true, dueDate: true, startDate: true },
    });
    if (!state) { notFoundCount++; continue; }

    const due   = state.dueDate   != null ? new Date(Number(state.dueDate))   : null;
    const start = state.startDate != null ? new Date(Number(state.startDate)) : null;

    // Descrição + comentários direto no ClickUp (não vêm no snapshot).
    let description: string | null = null;
    let comments: { text: string; at: string }[] | null = null;
    if (settings) {
      const [desc, cmts] = await Promise.all([
        fetchClickupTaskDescription(settings.apiToken, taskId),
        fetchClickupTaskComments(settings.apiToken, taskId),
      ]);
      description = desc || null;
      comments = sanitizeComments(cmts);
    }

    const task = await prisma.projectTask.create({
      data: {
        projectId:     id,
        title:         state.name,
        description,
        comments:      comments ?? undefined,
        done:          state.isCompleted,
        dueDate:       due   && !Number.isNaN(due.getTime())   ? due   : null,
        startDate:     start && !Number.isNaN(start.getTime()) ? start : null,
        clickupTaskId: taskId,
        createdById:   userId ?? null,
      },
      include: { assignee: { select: { id: true, name: true } } },
    });
    created.push(task);
  }

  // Compat com o caller antigo (import 1-a-1): devolve `task` quando foi só uma.
  return NextResponse.json({
    ok: true,
    imported: created.length,
    already: alreadyCount,
    notFound: notFoundCount,
    tasks: created,
    ...(created.length === 1 ? { task: created[0] } : {}),
  }, { status: 201 });
}
