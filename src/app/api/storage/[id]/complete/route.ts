import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { headObjectSize } from "@/lib/storage/s3";
import { authorizeTarget, targetOf } from "@/lib/storage/access";

// POST /api/storage/[id]/complete   Body: { draft? }
// Browser avisa que terminou de subir. Conferimos no bucket (HEAD) antes de
// marcar pronto — o tamanho gravado é o real, não o que o browser declarou.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const obj = await prisma.storageObject.findUnique({ where: { id } });
  if (!obj || obj.status !== "PENDING") return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });
  if (obj.uploadedById && obj.uploadedById !== (session.user as any)?.id) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  const target = targetOf(obj);
  if (!target) return NextResponse.json({ error: "Arquivo sem vínculo" }, { status: 400 });
  const auth = await authorizeTarget(session, target);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const size = await headObjectSize(obj.key);
  if (size === null) return NextResponse.json({ error: "Upload não encontrado no storage" }, { status: 409 });

  const file = await prisma.storageObject.update({
    where: { id },
    data: { size, status: body.draft && obj.ticketId ? "DRAFT" : "READY" },
    select: {
      id: true, fileName: true, mimeType: true, size: true, createdAt: true,
      ticketMessageId: true, uploadedById: true, uploadedBy: { select: { name: true } },
    },
  });

  // Feed de ações da tarefa: "X anexou arquivo.png". fromText guarda o id do
  // arquivo pra UI mostrar a miniatura.
  if (obj.projectTaskId) {
    const task = await prisma.projectTask.findUnique({
      where: { id: obj.projectTaskId },
      select: { projectId: true },
    });
    if (task) {
      await prisma.projectTaskEvent.create({
        data: {
          taskId: obj.projectTaskId, projectId: task.projectId, type: "FILE",
          fromText: file.id, toText: file.fileName,
          authorId: (session.user as any)?.id ?? null,
          authorName: (session.user as any)?.name ?? null,
        },
      }).catch(() => {});
    }
  }
  return NextResponse.json(file);
}
