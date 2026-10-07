import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getViewer, canSeeProject } from "@/lib/visibility";
import { listClickupAttachments, importClickupAttachments } from "@/lib/clickup-files";

async function authorize(session: any, projectId: string, taskId: string) {
  const role          = session.user.role as string;
  const userCompanyId = session.user.companyId as string | undefined;
  const task = await prisma.projectTask.findUnique({
    where:   { id: taskId },
    include: { project: { include: { setor: { select: { companyId: true } }, members: { select: { userId: true } }, accessUsers: { select: { userId: true } } } } },
  });
  if (!task || task.projectId !== projectId) return { error: "Tarefa não encontrada", status: 404 as const };
  if (role !== "SUPER_ADMIN" && task.project.setor.companyId !== userCompanyId) return { error: "Sem permissão", status: 403 as const };
  const viewer = await getViewer(session);
  if (!canSeeProject(viewer, {
    visibility: task.project.visibility, setorId: task.project.setorId,
    memberIds: task.project.members.map((m) => m.userId), accessUserIds: task.project.accessUsers.map((a) => a.userId),
  })) return { error: "Sem permissão", status: 403 as const };
  if (!task.clickupTaskId) return { error: "Tarefa não está ligada ao ClickUp", status: 400 as const };
  return { task };
}

// GET  /api/projetos/[id]/tasks/[taskId]/clickup-anexos → anexos da tarefa no ClickUp
// POST /api/projetos/[id]/tasks/[taskId]/clickup-anexos   Body: { ids?: string[] } (vazio = todos)
//      → copia pro LeadHub os escolhidos
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;
  const { id, taskId } = await params;
  const a = await authorize(session, id, taskId);
  if ("error" in a) return NextResponse.json({ error: a.error }, { status: a.status });
  try {
    return NextResponse.json({ attachments: await listClickupAttachments(taskId) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Falha ao ler o ClickUp" }, { status: 502 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;
  const { id, taskId } = await params;
  const a = await authorize(session, id, taskId);
  if ("error" in a) return NextResponse.json({ error: a.error }, { status: a.status });
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids) ? body.ids.map(String) : null;
  try {
    const r = await importClickupAttachments(taskId, ids, { id: (session.user as any).id, name: (session.user as any).name });
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Falha ao trazer do ClickUp" }, { status: 502 });
  }
}
