import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getViewer, canSeeProject } from "@/lib/visibility";
import { getClickupSettings, fetchClickupTaskLite } from "@/lib/clickup";
import { listClickupAttachments, importClickupAttachments } from "@/lib/clickup-files";
import { pullClickupIntoTask, LINKED_TASK_SELECT } from "@/lib/project-task-pull";

const IMAGE_EXT = /^(png|jpe?g|webp|gif|avif|heic)$/i;

// POST /api/projetos/[id]/tasks/[taskId]/sync-clickup
//
// Sincroniza SÓ esta tarefa com o ClickUp — sem rodar o sync do projeto
// inteiro (que busca a lista toda e passa por todas as tarefas). Puxa título,
// datas, descritivo, comentários e conclusão (mesma regra do sync do projeto)
// e traz as IMAGENS novas pro andamento. Outros anexos (txt, pdf…) continuam
// no "Trazer" manual do quadro de anexos: nem todo arquivo do ClickUp é peça.
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
      ...LINKED_TASK_SELECT,
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
  if (!task.clickupTaskId) {
    return NextResponse.json({ error: "Esta tarefa não está ligada ao ClickUp." }, { status: 400 });
  }

  const settings = await getClickupSettings(task.project.setor.companyId);
  if (!settings?.apiToken) {
    return NextResponse.json({ error: "ClickUp não configurado nesta empresa." }, { status: 503 });
  }

  const remote = await fetchClickupTaskLite(settings.apiToken, task.clickupTaskId);
  if (!remote) {
    return NextResponse.json({ error: "Não consegui ler a tarefa no ClickUp (apagada ou sem acesso?)." }, { status: 502 });
  }
  await pullClickupIntoTask(settings.apiToken, task, remote.task);

  // Imagens novas → andamento (viram cards com status, entram no "Para aprovar").
  let images = 0;
  let imageError: string | null = null;
  try {
    const atts = await listClickupAttachments(taskId);
    const ids = atts
      .filter((a) => !a.imported && (/^image\//i.test(a.mimeType) || IMAGE_EXT.test(a.extension)))
      .map((a) => a.id);
    if (ids.length) {
      const r = await importClickupAttachments(taskId, ids, {
        id: (session.user as any).id, name: (session.user as any).name,
      });
      images = r.imported;
      if (r.errors.length) imageError = r.errors[0];
    }
  } catch (e: any) {
    imageError = e?.message ?? "Falha ao trazer as imagens";
  }

  // Devolve o estado novo: o modal guarda os campos em estado local e não
  // enxergaria a mudança só com router.refresh().
  const fresh = await prisma.projectTask.findUnique({
    where:  { id: taskId },
    select: { title: true, description: true, startDate: true, dueDate: true, status: true, comments: true },
  });
  return NextResponse.json({
    ok: true,
    images,
    ...(imageError ? { warning: imageError } : {}),
    task: fresh && {
      ...fresh,
      startDate: fresh.startDate?.toISOString() ?? null,
      dueDate:   fresh.dueDate?.toISOString() ?? null,
    },
  });
}
