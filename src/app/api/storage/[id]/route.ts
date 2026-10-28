import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { presignDownload, deleteObject, MEDIA_TTL_SEC } from "@/lib/storage/s3";
import { authorizeTarget, targetOf, isManager } from "@/lib/storage/access";

// Tipos que o navegador pode abrir direto (preview). O resto sempre baixa —
// evita HTML/script servido inline a partir do domínio do storage.
const INLINE_OK = /^(image\/(png|jpe?g|gif|webp|avif)|application\/pdf|video\/(mp4|webm|quicktime)|audio\/[\w.+-]+|text\/plain)$/i;

// Vídeo/áudio toca baixando aos pedaços: link com validade maior.
const mediaTtl = (mime: string) => (/^(video|audio)\//i.test(mime) ? { ttlSec: MEDIA_TTL_SEC } : {});

async function load(session: any, id: string) {
  const obj = await prisma.storageObject.findUnique({ where: { id } });
  if (!obj || obj.status === "PENDING") return { error: "Arquivo não encontrado", status: 404 as const };
  const target = targetOf(obj);
  if (!target) return { error: "Arquivo sem vínculo", status: 404 as const };
  const auth = await authorizeTarget(session, target);
  if (!auth.ok) return { error: auth.error, status: auth.status };
  // Cliente na biblioteca: só abre o que a agência liberou pra ele.
  if (auth.asClient && target.kind === "library") {
    const item = await prisma.clientLibraryItem.findUnique({
      where: { storageObjectId: obj.id },
      select: { visibleToClient: true },
    });
    if (!item?.visibleToClient) return { error: "Arquivo não encontrado", status: 404 as const };
  }
  // Cliente no chamado: anexo de mensagem INTERNA da equipe nunca abre pra ele.
  if (auth.asClient && target.kind === "ticket" && obj.ticketMessageId) {
    const msg = await prisma.ticketMessage.findUnique({
      where: { id: obj.ticketMessageId },
      select: { isInternal: true },
    });
    if (!msg || msg.isInternal) return { error: "Arquivo não encontrado", status: 404 as const };
  }
  return { obj, asClient: !!auth.asClient };
}

// Página pública de acompanhamento do chamado (/acompanhar/[token], sem login):
// o link libera os arquivos DAQUELE chamado — nunca de mensagem interna.
async function loadByTicketToken(id: string, token: string) {
  const obj = await prisma.storageObject.findUnique({ where: { id } });
  if (!obj || obj.status !== "READY" || !obj.ticketId) return null;
  const ticket = await prisma.ticket.findUnique({ where: { id: obj.ticketId }, select: { publicToken: true } });
  if (!ticket?.publicToken || ticket.publicToken !== token) return null;
  if (obj.ticketMessageId) {
    const msg = await prisma.ticketMessage.findUnique({ where: { id: obj.ticketMessageId }, select: { isInternal: true } });
    if (!msg || msg.isInternal) return null;
  }
  return obj;
}

// GET /api/storage/[id]            → abre (preview quando seguro)
// GET /api/storage/[id]?download=1 → força download
// GET /api/storage/[id]?t=<token>  → página pública do chamado, sem login
// Redireciona pra uma URL assinada de curta duração no MinIO.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const download = req.nextUrl.searchParams.get("download") === "1";

  const token = req.nextUrl.searchParams.get("t");
  if (token) {
    const obj = await loadByTicketToken(id, token);
    if (obj) {
      const url = await presignDownload(obj.key, obj.fileName, { download: download || !INLINE_OK.test(obj.mimeType), ...mediaTtl(obj.mimeType) });
      const res = NextResponse.redirect(url, 302);
      res.headers.set("Cache-Control", "private, no-store");
      return res;
    }
  }

  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const r = await load(session, id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });

  const url = await presignDownload(r.obj.key, r.obj.fileName, { download: download || !INLINE_OK.test(r.obj.mimeType), ...mediaTtl(r.obj.mimeType) });
  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

// DELETE /api/storage/[id] — quem enviou ou ADMIN/SUPER_ADMIN.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const r = await load(session, id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });

  const userId = (session.user as any)?.id as string | undefined;
  if (r.asClient) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  if (!isManager(session) && r.obj.uploadedById !== userId) {
    return NextResponse.json({ error: "Só quem enviou ou um gestor pode excluir" }, { status: 403 });
  }

  await deleteObject(r.obj.key);
  await prisma.storageObject.delete({ where: { id } });

  if (r.obj.projectTaskId) {
    const task = await prisma.projectTask.findUnique({
      where: { id: r.obj.projectTaskId },
      select: { projectId: true },
    });
    if (task) {
      await prisma.projectTaskEvent.create({
        data: {
          taskId: r.obj.projectTaskId, projectId: task.projectId, type: "FILE_REMOVED",
          toText: r.obj.fileName,
          authorId: userId ?? null,
          authorName: (session.user as any)?.name ?? null,
        },
      }).catch(() => {});
    }
  }
  return NextResponse.json({ ok: true });
}
