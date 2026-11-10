import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { assertModule } from "./billing";
import { getViewer, canSeeProject } from "./visibility";

type SessionUser = { id?: string; name?: string | null; role?: string; companyId?: string };

/**
 * Quem pode mexer numa tarefa de projeto: módulo Projetos ligado, mesma
 * agência (ou super admin) e enxerga o projeto (aberto/restrito). Mesmas
 * regras das rotas de tarefa (comment, aprovacao…).
 */
export async function authorizeProjectTask(
  session: { user?: unknown } | null,
  projectId: string,
  taskId: string,
): Promise<
  | { ok: true; user: SessionUser; task: { id: string; projectId: string; status: string; approvalRound: number } }
  | { ok: false; response: NextResponse }
> {
  if (!session) return { ok: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return { ok: false, response: gate.response };

  const user = (session.user ?? {}) as SessionUser;
  const task = await prisma.projectTask.findUnique({
    where:  { id: taskId },
    select: {
      id: true, projectId: true, status: true, approvalRound: true,
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
  if (!task || task.projectId !== projectId) {
    return { ok: false, response: NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 }) };
  }
  if (user.role !== "SUPER_ADMIN" && task.project.setor.companyId !== user.companyId) {
    return { ok: false, response: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  const viewer = await getViewer(session);
  if (!canSeeProject(viewer, {
    visibility:    task.project.visibility,
    setorId:       task.project.setorId,
    memberIds:     task.project.members.map((m) => m.userId),
    accessUserIds: task.project.accessUsers.map((a) => a.userId),
  })) {
    return { ok: false, response: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  return { ok: true, user, task: { id: task.id, projectId: task.projectId, status: task.status, approvalRound: task.approvalRound } };
}
