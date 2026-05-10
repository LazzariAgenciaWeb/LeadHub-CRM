import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// GET /api/leads/[id]/tasks  → tarefas do lead (mais antigas/atrasadas primeiro)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const lead = await prisma.lead.findUnique({ where: { id }, select: { companyId: true } });
  if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && lead.companyId !== userCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const tasks = await prisma.task.findMany({
    where: { leadId: id },
    orderBy: [{ done: "asc" }, { dueAt: "asc" }],
    include: {
      assignee:  { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json(tasks);
}

// POST /api/leads/[id]/tasks  → cria tarefa
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const userId = (session.user as any).id as string;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const lead = await prisma.lead.findUnique({ where: { id }, select: { companyId: true } });
  if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && lead.companyId !== userCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const title: string = (body.title ?? "").trim();
  const dueAtRaw: string | undefined = body.dueAt;
  const notes: string | null = body.notes?.trim() || null;
  const assigneeId: string | null = body.assigneeId || null;

  if (!title) return NextResponse.json({ error: "Título obrigatório" }, { status: 400 });
  if (!dueAtRaw) return NextResponse.json({ error: "Data obrigatória" }, { status: 400 });
  const dueAt = new Date(dueAtRaw);
  if (Number.isNaN(dueAt.getTime())) return NextResponse.json({ error: "Data inválida" }, { status: 400 });

  const task = await prisma.task.create({
    data: {
      title,
      dueAt,
      notes,
      leadId: id,
      companyId: lead.companyId,
      assigneeId: assigneeId ?? userId,
      createdById: userId,
    },
    include: {
      assignee:  { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(task, { status: 201 });
}
