import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { readComments, sanitizeComments, type TaskComment } from "@/lib/checklist";
import { Prisma } from "@/generated/prisma";
import { getClickupSettings, addCommentToClickupTask } from "@/lib/clickup";

// POST /api/meu-espaco/tarefas/[taskId]/responder
// O CLIENTE logado responde/retorna numa tarefa marcada como "aguardando você".
// A resposta vira um comentário (by:"client") e tira a tarefa do "aguardando".
export async function POST(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await getEffectiveSession();
  const companyId = (session?.user as any)?.companyId as string | undefined;
  const role = (session?.user as any)?.role as string | undefined;
  if (!companyId || role === "SUPER_ADMIN") {
    return NextResponse.json({ error: "Ação disponível apenas para clientes." }, { status: 403 });
  }

  const { taskId } = await params;
  const body = await req.json().catch(() => ({}));
  const text = String(body?.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Escreva sua resposta." }, { status: 400 });

  // A tarefa precisa ser de um projeto do PRÓPRIO cliente.
  const task = await prisma.projectTask.findUnique({
    where: { id: taskId },
    select: {
      id: true, comments: true, clickupTaskId: true,
      project: { select: { clientCompanyId: true, setor: { select: { companyId: true } } } },
    },
  });
  if (!task || task.project.clientCompanyId !== companyId) {
    return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 });
  }

  // Se a tarefa é vinculada ao ClickUp, a resposta do cliente também vira
  // comentário lá (prefixada). Guarda o cid pra dedup (não volta como eco).
  let cid: string | undefined;
  if (task.clickupTaskId) {
    try {
      const settings = await getClickupSettings(task.project.setor.companyId);
      if (settings?.apiToken) {
        const newId = await addCommentToClickupTask({ apiToken: settings.apiToken, taskId: task.clickupTaskId, comment: `[Cliente] ${text}` });
        if (newId) cid = newId;
      }
    } catch { /* silencioso */ }
  }

  const c: TaskComment = { text, at: new Date().toISOString(), by: "client" };
  if (cid) c.cid = cid;
  const next = [...readComments(task.comments), c];

  await prisma.projectTask.update({
    where: { id: taskId },
    data: {
      comments:       sanitizeComments(next) ?? Prisma.DbNull,
      awaitingClient: false, // respondeu → sai do "aguardando você"
    },
  });

  return NextResponse.json({ ok: true });
}
