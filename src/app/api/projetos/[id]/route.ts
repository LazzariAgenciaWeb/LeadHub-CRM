import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { ProjectStatus } from "@/generated/prisma";
import { addScoreOnce } from "@/lib/gamification";

// GET /api/projetos/[id]
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const project = await prisma.setorClickupList.findUnique({
    where: { id },
    include: {
      setor:         { select: { id: true, name: true, companyId: true } },
      clientCompany: { select: { id: true, name: true } },
      members:       { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });
  if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });

  if (role !== "SUPER_ADMIN" && project.setor.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  return NextResponse.json(project);
}

// PATCH /api/projetos/[id]
// Body: { name?, description?, type?, status?, startDate?, dueDate?, clientCompanyId?, memberIds? }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const userId        = (session.user as any).id as string | undefined;

  const existing = await prisma.setorClickupList.findUnique({
    where: { id },
    include: { setor: { select: { companyId: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && existing.setor.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const { name, description, type, status, startDate, dueDate, clientCompanyId, memberIds, clickupListId } = body;

  // Detecta transição pra ENTREGUE — gera pontos pros membros
  const movingToDelivered = status === "ProjectStatus" || status === "ENTREGUE";
  const wasNotDelivered   = existing.status !== "ENTREGUE";
  const becameDelivered   = movingToDelivered && wasNotDelivered;

  const data: any = {};
  if (name        !== undefined) data.name = name;
  if (description !== undefined) data.description = description ?? null;
  if (type        !== undefined) data.type = type ?? null;
  if (status      !== undefined) data.status = status as ProjectStatus;
  if (startDate   !== undefined) data.startDate = startDate ? new Date(startDate) : null;
  if (dueDate     !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
  if (clientCompanyId !== undefined) data.clientCompanyId = clientCompanyId ?? null;
  if (clickupListId !== undefined && typeof clickupListId === "string" && clickupListId.trim()) {
    data.clickupListId = clickupListId.trim();
    // Quando muda a lista, descarta snapshot antigo (tasks são de outra lista)
    await prisma.projectTaskState.deleteMany({ where: { projectId: id } }).catch(() => {});
  }
  if (becameDelivered) data.deliveredAt = new Date();

  const project = await prisma.setorClickupList.update({
    where: { id },
    data,
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
    },
  });

  // Atualiza membros se enviado memberIds
  if (Array.isArray(memberIds)) {
    await prisma.projectMember.deleteMany({ where: { projectId: id } });
    if (memberIds.length > 0) {
      await prisma.projectMember.createMany({
        data: memberIds.map((uid: string) => ({ projectId: id, userId: uid })),
        skipDuplicates: true,
      });
    }
  }

  // Gamificação
  if (becameDelivered && existing.setor.companyId) {
    const members = await prisma.projectMember.findMany({
      where:  { projectId: id },
      select: { userId: true },
    });

    // Se ninguém marcado, dá pontos pra quem fechou
    const recipients = members.length > 0
      ? members.map((m) => m.userId)
      : userId ? [userId] : [];

    const noPrazo = !existing.dueDate || project.deliveredAt! <= existing.dueDate;
    const atrasado = existing.dueDate && project.deliveredAt! > existing.dueDate;

    for (const uid of recipients) {
      void addScoreOnce(uid, existing.setor.companyId, "PROJETO_ENTREGUE", id).catch(() => {});
      if (noPrazo) {
        void addScoreOnce(uid, existing.setor.companyId, "PROJETO_ENTREGUE_NO_PRAZO", id).catch(() => {});
      }
      if (atrasado) {
        void addScoreOnce(uid, existing.setor.companyId, "PROJETO_ATRASADO", id).catch(() => {});
      }
    }
  }

  // Nota: NÃO penalizamos mais por empurrar dueDate de projeto. As tarefas
  // sem prazo / atrasadas no ClickUp já cobrem essa lógica via cron diário,
  // de forma mais aderente à realidade (a equipe corrige preenchendo o
  // ClickUp, não importa quantas vezes mexa no dueDate macro do projeto).

  return NextResponse.json(project);
}

// DELETE /api/projetos/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const project = await prisma.setorClickupList.findUnique({
    where: { id },
    include: { setor: { select: { companyId: true } } },
  });
  if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && project.setor.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  await prisma.setorClickupList.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
