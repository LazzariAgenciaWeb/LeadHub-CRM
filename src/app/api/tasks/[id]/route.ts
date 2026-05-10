import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { addScore } from "@/lib/gamification";

// PATCH /api/tasks/[id]  → marcar feita, editar título/data/responsável
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const task = await prisma.task.findUnique({
    where: { id },
    select: { companyId: true, source: true, done: true, assigneeId: true },
  });
  if (!task) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && task.companyId !== userCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const data: any = {};

  if (typeof body.title === "string") {
    const t = body.title.trim();
    if (!t) return NextResponse.json({ error: "Título inválido" }, { status: 400 });
    data.title = t;
  }
  if (body.dueAt !== undefined) {
    const d = new Date(body.dueAt);
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "Data inválida" }, { status: 400 });
    data.dueAt = d;
  }
  if (body.notes !== undefined) data.notes = body.notes?.trim() || null;
  if (body.assigneeId !== undefined) data.assigneeId = body.assigneeId || null;
  if (body.done !== undefined) {
    data.done = !!body.done;
    data.doneAt = body.done ? new Date() : null;
  }

  const updated = await prisma.task.update({
    where: { id },
    data,
    include: {
      assignee:  { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });

  // Gamificação: pontua quem marcou a tarefa como FEITA (transição false → true).
  // Só pontua se o user que clicou for o próprio assignee (evita admin marcar p/ vendedor)
  // ou se a tarefa não tiver assignee. Sinal quente vale mais do que tarefa normal.
  const transitionedToDone = !task.done && data.done === true;
  if (transitionedToDone) {
    const userId = (session.user as any).id as string;
    const isAssignee = !task.assigneeId || task.assigneeId === userId;
    if (isAssignee) {
      const reason = task.source === "AUTO_LINK_OPEN"
        ? "SINAL_QUENTE_RESPONDIDO"
        : "TAREFA_LEADHUB_FEITA";
      // fire-and-forget — não bloqueia resposta
      addScore(userId, task.companyId, reason as any, id).catch(() => {});
    }
  }

  return NextResponse.json(updated);
}

// DELETE /api/tasks/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const task = await prisma.task.findUnique({ where: { id }, select: { companyId: true } });
  if (!task) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && task.companyId !== userCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.task.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
