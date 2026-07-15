import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getViewer, canSeeProject } from "@/lib/visibility";
import { readComments, sanitizeComments, type TaskComment } from "@/lib/checklist";
import { Prisma } from "@/generated/prisma";
import { getClickupSettings, addCommentToClickupTask } from "@/lib/clickup";

// POST /api/projetos/[id]/tasks/[taskId]/comment
// Adiciona UMA atualização/comentário da equipe na tarefa e — quando a tarefa está
// vinculada ao ClickUp — empurra o mesmo comentário pra lá, guardando o `cid`
// retornado pra dedup (o webhook/sync não recria — evita eco). Body: { text, vis? }.
export async function POST(
  req: NextRequest,
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
    where:   { id: taskId },
    include: {
      project: {
        include: {
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

  const body = await req.json().catch(() => ({}));
  const text = String(body?.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Escreva o comentário." }, { status: 400 });
  const internal = body?.vis === false;

  // Empurra pro ClickUp (best-effort). Guarda o cid pra dedup no sync/webhook.
  let cid: string | undefined;
  if (task.clickupTaskId) {
    try {
      const settings = await getClickupSettings(task.project.setor.companyId);
      if (settings?.apiToken) {
        const newId = await addCommentToClickupTask({ apiToken: settings.apiToken, taskId: task.clickupTaskId, comment: text });
        if (newId) cid = newId;
      }
    } catch { /* silencioso — comentário local não depende do ClickUp */ }
  }

  const c: TaskComment = { text, at: new Date().toISOString() };
  if (internal) c.vis = false;
  if (cid) c.cid = cid;

  const next = [...readComments(task.comments), c];
  await prisma.projectTask.update({
    where: { id: taskId },
    data:  { comments: sanitizeComments(next) ?? Prisma.DbNull },
  });

  return NextResponse.json({ ok: true, pushedToClickup: !!cid, comments: next });
}
