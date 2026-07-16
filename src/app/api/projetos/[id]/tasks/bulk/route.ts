import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getViewer, canSeeProject } from "@/lib/visibility";

// PATCH /api/projetos/[id]/tasks/bulk
// Atualização em massa de tarefas internas do projeto.
// Body: { taskIds: string[], projectServiceId?, stage?, visibleToClient? }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const project = await prisma.setorClickupList.findUnique({
    where: { id },
    include: {
      setor: { select: { companyId: true } },
      members: { select: { userId: true } },
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

  const body = await req.json();
  const taskIds: string[] = Array.isArray(body.taskIds) ? body.taskIds.filter((x: unknown) => typeof x === "string") : [];
  if (taskIds.length === 0) return NextResponse.json({ error: "Nenhuma tarefa selecionada" }, { status: 400 });

  const { projectServiceId, stage, visibleToClient } = body;
  const data: any = {};

  if (typeof visibleToClient === "boolean") {
    data.visibleToClient = visibleToClient;
  }

  // Serviço/etapa da sequência — espelha o nome no `stage` (fallback), igual à
  // rota individual. Aplica o MESMO serviço/etapa a todas as tarefas escolhidas.
  if (projectServiceId !== undefined) {
    if (projectServiceId) {
      const step = await prisma.projectService.findUnique({
        where: { id: String(projectServiceId) },
        select: { projectId: true, name: true, service: { select: { name: true } } },
      });
      if (!step || step.projectId !== id) {
        return NextResponse.json({ error: "Serviço inválido" }, { status: 400 });
      }
      data.projectServiceId = String(projectServiceId);
      data.stage = (step.name || step.service?.name || "").slice(0, 80) || null;
    } else {
      data.projectServiceId = null;
    }
  }
  // Etapa livre (projetos sem serviços cadastrados).
  if (stage !== undefined && projectServiceId === undefined) {
    data.stage = stage && String(stage).trim() ? String(stage).trim().slice(0, 80) : null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada pra atualizar" }, { status: 400 });
  }

  // updateMany com guarda de projeto — só toca tarefas deste projeto.
  const result = await prisma.projectTask.updateMany({
    where: { id: { in: taskIds }, projectId: id },
    data,
  });

  return NextResponse.json({ ok: true, updated: result.count });
}
