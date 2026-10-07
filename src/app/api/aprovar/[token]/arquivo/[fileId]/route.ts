import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { presignDownload } from "@/lib/storage/s3";
import { fileVisibleToClient } from "@/lib/client-task-files";

// Mesma lista do /api/storage/[id]: só abre no navegador o que é seguro.
const INLINE_OK = /^(image\/(png|jpe?g|gif|webp|avif)|application\/pdf|video\/(mp4|webm|quicktime)|audio\/[\w.+-]+|text\/plain)$/i;

// GET /api/aprovar/[token]/arquivo/[fileId] — arquivo da peça no link de
// aprovação. O token só abre arquivos DESTA tarefa e visíveis ao cliente.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; fileId: string }> },
) {
  const { token, fileId } = await params;
  const task = await prisma.projectTask.findUnique({
    where:  { approvalToken: token },
    select: { id: true, comments: true },
  });
  if (!task) return new NextResponse("Não encontrado", { status: 404 });

  const obj = await prisma.storageObject.findUnique({
    where:  { id: fileId },
    select: { key: true, fileName: true, mimeType: true, status: true, projectTaskId: true },
  });
  if (!obj || obj.status !== "READY" || obj.projectTaskId !== task.id || !fileVisibleToClient(task.comments, fileId)) {
    return new NextResponse("Não encontrado", { status: 404 });
  }

  const download = req.nextUrl.searchParams.get("download") === "1" || !INLINE_OK.test(obj.mimeType);
  const url = await presignDownload(obj.key, obj.fileName, { download });
  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
