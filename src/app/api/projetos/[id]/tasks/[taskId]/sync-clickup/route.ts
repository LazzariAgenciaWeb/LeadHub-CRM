import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getViewer, canSeeProject } from "@/lib/visibility";
import { syncOneProjectTask } from "@/lib/project-task-pull";

// POST /api/projetos/[id]/tasks/[taskId]/sync-clickup
//
// Sincroniza SÓ esta tarefa com o ClickUp — sem rodar o sync do projeto
// inteiro (que busca a lista toda e passa por todas as tarefas). Puxa título,
// datas, descritivo, comentários e conclusão (mesma regra do sync do projeto).
// Anexos ficam no "Trazer" manual do quadro de anexos — a equipe escolhe o que
// é peça; aqui só informa quantas imagens novas existem.
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
    where: { id: taskId },
    select: {
      projectId: true,
      project: {
        select: {
          visibility: true, setorId: true,
          setor:       { select: { companyId: true } },
          members:     { select: { userId: true } },
          accessUsers: { select: { userId: true } },
        },
      },
    },
  });
  if (!task || task.projectId !== id) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && task.project.setor.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  const viewer = await getViewer(session);
  if (!canSeeProject(viewer, {
    visibility: task.project.visibility,
    setorId: task.project.setorId,
    memberIds: task.project.members.map((m) => m.userId),
    accessUserIds: task.project.accessUsers.map((a) => a.userId),
  })) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  const r = await syncOneProjectTask(taskId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  // Devolve o estado novo: o modal guarda os campos em estado local e não
  // enxergaria a mudança só com router.refresh().
  const fresh = await prisma.projectTask.findUnique({
    where:  { id: taskId },
    select: { title: true, description: true, startDate: true, dueDate: true, status: true, comments: true },
  });
  return NextResponse.json({
    ok: true,
    pendingImages: r.pendingImages,
    task: fresh && {
      ...fresh,
      startDate: fresh.startDate?.toISOString() ?? null,
      dueDate:   fresh.dueDate?.toISOString() ?? null,
    },
  });
}
