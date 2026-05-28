import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getClickupSettings, createClickupTask } from "@/lib/clickup";

// POST /api/projetos/[id]/tasks
//
// Cria uma tarefa dentro do projeto. Dois destinos:
//   destino="interna" → tarefa nativa do LeadHub (ProjectTask), fora do ClickUp.
//   destino="clickup" → cria a task na lista do ClickUp do projeto e registra
//                       no snapshot (ProjectTaskState) pra aparecer na hora.
//
// Body: { destino, title, description?, priority?, dueDate?, assigneeId? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const userId        = (session.user as any).id as string | undefined;
  const userName      = (session.user as any).name as string | undefined;

  const project = await prisma.setorClickupList.findUnique({
    where: { id },
    include: { setor: { select: { companyId: true } } },
  });
  if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && project.setor.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const { destino, title, description, priority, dueDate, assigneeId } = body;

  if (!title || !String(title).trim()) {
    return NextResponse.json({ error: "Título é obrigatório" }, { status: 400 });
  }
  const prio = ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(priority) ? priority : "MEDIUM";
  const due  = dueDate ? new Date(dueDate) : null;
  if (due && Number.isNaN(due.getTime())) {
    return NextResponse.json({ error: "Prazo inválido" }, { status: 400 });
  }

  // ── Destino ClickUp ──────────────────────────────────────────────────────
  if (destino === "clickup") {
    const settings = await getClickupSettings(project.setor.companyId);
    if (!settings || !project.clickupListId) {
      return NextResponse.json(
        { error: "ClickUp não configurado para este projeto. Crie como tarefa interna." },
        { status: 400 },
      );
    }

    const newTaskId = await createClickupTask({
      apiToken: settings.apiToken,
      listId: project.clickupListId,
      name: String(title).trim(),
      description: description ? String(description) : undefined,
      priority: prio,
      dueDate: due ? due.getTime() : undefined,
      tags: ["projeto"],
    });
    if (!newTaskId) {
      return NextResponse.json({ error: "Falha ao criar a tarefa no ClickUp" }, { status: 502 });
    }

    // Insere no snapshot pra aparecer já (o cron mantém daqui pra frente).
    await prisma.projectTaskState.upsert({
      where:  { projectId_taskId: { projectId: id, taskId: newTaskId } },
      create: {
        projectId:     id,
        taskId:        newTaskId,
        name:          String(title).trim(),
        statusName:    null,
        isCompleted:   false,
        hasNoAssignee: true,
        dueDate:       due ? BigInt(due.getTime()) : null,
      },
      update: {},
    }).catch(() => {});

    await prisma.projectActivity.create({
      data: {
        projectId:  id,
        type:       "TASK_CREATED",
        taskName:   String(title).trim(),
        taskId:     newTaskId,
        authorId:   userId ?? null,
        authorName: userName ?? "Sistema",
      },
    }).catch(() => {});

    return NextResponse.json({ ok: true, destino: "clickup", taskId: newTaskId }, { status: 201 });
  }

  // ── Destino interno (LeadHub) ──────────────────────────────────────────────
  const task = await prisma.projectTask.create({
    data: {
      projectId:   id,
      title:       String(title).trim(),
      description: description ? String(description) : null,
      priority:    prio,
      dueDate:     due,
      assigneeId:  assigneeId || null,
      createdById: userId ?? null,
    },
    include: { assignee: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ ok: true, destino: "interna", task }, { status: 201 });
}
