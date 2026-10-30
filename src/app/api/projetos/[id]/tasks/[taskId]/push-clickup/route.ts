import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { pushTaskToClickup } from "@/lib/project-etapas";

// POST /api/projetos/[id]/tasks/[taskId]/push-clickup
// Pega uma tarefa NATIVA (sem vínculo) e a cria no ClickUp, amarrando o
// clickupTaskId — a partir daí ela entra no sync bidirecional. Idempotente:
// se já está vinculada, não faz nada. Tarefa dentro de uma etapa sobe como
// SUBTAREFA da tarefa principal da etapa, não solta na raiz da lista.
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
    where:  { id: taskId },
    select: { projectId: true, project: { select: { setor: { select: { companyId: true } } } } },
  });
  if (!task || task.projectId !== id) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && task.project.setor.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const r = await pushTaskToClickup(taskId);
  if (!r.ok) {
    const status = r.reason.startsWith("ClickUp não configurado") ? 503
                 : r.reason.startsWith("Falha") ? 502 : 400;
    return NextResponse.json({ error: r.reason }, { status });
  }
  return NextResponse.json({
    ok: true,
    clickupTaskId: r.clickupTaskId,
    ...(r.already ? { alreadyLinked: true } : { parentTaskId: r.parentTaskId }),
  });
}
