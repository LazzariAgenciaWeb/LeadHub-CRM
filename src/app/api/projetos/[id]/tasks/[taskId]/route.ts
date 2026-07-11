import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getViewer, canSeeProject } from "@/lib/visibility";
import { sanitizeChecklist, sanitizeComments } from "@/lib/checklist";
import { Prisma } from "@/generated/prisma";
import { getClickupSettings, updateClickupTask } from "@/lib/clickup";

// Tarefas internas (ProjectTask) só. Tarefas do ClickUp são geridas no ClickUp.

async function loadAndAuthorize(
  session: any,
  projectId: string,
  taskId: string,
) {
  const role          = session.user.role as string;
  const userCompanyId = session.user.companyId as string | undefined;

  const task = await prisma.projectTask.findUnique({
    where:   { id: taskId },
    include: {
      project: {
        include: {
          setor:       { select: { companyId: true } },
          members:     { select: { userId: true } },
          accessUsers: { select: { userId: true } },
        },
      },
    },
  });
  if (!task || task.projectId !== projectId) return { error: "Tarefa não encontrada", status: 404 as const };
  if (role !== "SUPER_ADMIN" && task.project.setor.companyId !== userCompanyId) {
    return { error: "Sem permissão", status: 403 as const };
  }
  const viewer = await getViewer(session);
  if (!canSeeProject(viewer, {
    visibility: task.project.visibility,
    setorId: task.project.setorId,
    memberIds: task.project.members.map((m) => m.userId),
    accessUserIds: task.project.accessUsers.map((a) => a.userId),
  })) {
    return { error: "Sem permissão", status: 403 as const };
  }
  return { task };
}

// PATCH /api/projetos/[id]/tasks/[taskId]
// Body: { done?, title?, description?, priority?, dueDate?, assigneeId? }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id, taskId } = await params;
  const res = await loadAndAuthorize(session, id, taskId);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const body = await req.json();
  const { done, title, description, priority, dueDate, startDate, assigneeId, stage, checklist, comments, awaitingClient } = body;

  const data: any = {};
  if (done !== undefined) {
    data.done = !!done;
    data.completedAt = done ? new Date() : null;
  }
  if (title !== undefined && String(title).trim()) data.title = String(title).trim();
  if (description !== undefined) data.description = description ? String(description) : null;
  if (priority !== undefined && ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(priority)) data.priority = priority;
  if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
  if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
  if (assigneeId !== undefined) data.assigneeId = assigneeId || null;
  if (stage !== undefined) data.stage = stage && String(stage).trim() ? String(stage).trim().slice(0, 80) : null;
  if (checklist !== undefined) data.checklist = sanitizeChecklist(checklist) ?? Prisma.DbNull;
  if (comments !== undefined) data.comments = sanitizeComments(comments) ?? Prisma.DbNull;
  if (awaitingClient !== undefined) data.awaitingClient = !!awaitingClient;

  const task = await prisma.projectTask.update({
    where:   { id: taskId },
    data,
    include: { assignee: { select: { id: true, name: true } } },
  });

  // Fase 2 (interna → ClickUp): se a tarefa é vinculada, reflete título/prazo lá.
  // Best-effort — falha no ClickUp NÃO quebra a atualização interna.
  if (res.task.clickupTaskId && (data.title !== undefined || data.dueDate !== undefined)) {
    try {
      const settings = await getClickupSettings(res.task.project.setor.companyId);
      if (settings) {
        await updateClickupTask({
          apiToken: settings.apiToken,
          taskId:   res.task.clickupTaskId,
          name:     data.title as string | undefined,
          dueDate:  data.dueDate !== undefined ? (data.dueDate instanceof Date ? data.dueDate.getTime() : null) : undefined,
        });
      }
    } catch { /* silencioso */ }
  }

  return NextResponse.json(task);
}

// DELETE /api/projetos/[id]/tasks/[taskId]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id, taskId } = await params;
  const res = await loadAndAuthorize(session, id, taskId);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  await prisma.projectTask.delete({ where: { id: taskId } });
  return NextResponse.json({ ok: true });
}
