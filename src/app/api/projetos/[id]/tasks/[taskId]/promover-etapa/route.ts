import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { promoteTaskToEtapa } from "@/lib/project-etapas";

// POST /api/projetos/[id]/tasks/[taskId]/promover-etapa
//
// Diz "esta tarefa é uma etapa". É o caminho pra arrumar o que já existe: a
// tarefa principal que veio do ClickUp (o mês) vira etapa reusando a MESMA
// tarefa de lá — nada novo é criado no ClickUp — e as subtarefas dela entram
// dentro da etapa, saindo de "A organizar" de uma vez.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id, taskId } = await params;
  const user          = session.user as { role?: string; companyId?: string };
  const role          = user.role;
  const userCompanyId = user.companyId;

  const task = await prisma.projectTask.findUnique({
    where:  { id: taskId },
    select: { projectId: true, project: { select: { setor: { select: { companyId: true } } } } },
  });
  if (!task || task.projectId !== id) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && task.project.setor.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const r = await promoteTaskToEtapa(taskId);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
  return NextResponse.json(r);
}
