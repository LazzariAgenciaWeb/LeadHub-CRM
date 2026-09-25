import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { presignDownload } from "@/lib/storage/s3";
import { fileVisibleToClient } from "@/lib/client-task-files";

// Mesma lista do /api/storage/[id]: só abre no navegador o que é seguro.
const INLINE_OK = /^(image\/(png|jpe?g|gif|webp|avif)|application\/pdf|video\/(mp4|webm|quicktime)|audio\/[\w.+-]+|text\/plain)$/i;

/**
 * GET /api/projetos/[id]/arquivos/[fileId]            → abre (preview quando seguro)
 * GET /api/projetos/[id]/arquivos/[fileId]?download=1 → baixa
 *
 * Arquivo de tarefa pro painel do CLIENTE. O /api/storage/[id] só libera a
 * equipe da agência; aqui o acesso é:
 *   • `?t=<publicToken>` do projeto (painel público /c/[token]), OU
 *   • sessão do cliente dono do projeto (clientCompanyId), OU
 *   • equipe da agência / SUPER_ADMIN.
 * Pro cliente, a tarefa precisa estar visível e o arquivo não pode estar preso
 * só a andamento interno.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;

  const obj = await prisma.storageObject.findUnique({
    where:  { id: fileId },
    select: { key: true, fileName: true, mimeType: true, status: true, projectTaskId: true },
  });
  if (!obj || obj.status !== "READY" || !obj.projectTaskId) {
    return new NextResponse("Não encontrado", { status: 404 });
  }

  const task = await prisma.projectTask.findUnique({
    where:  { id: obj.projectTaskId },
    select: {
      projectId: true, visibleToClient: true, ignoredAt: true, comments: true,
      project: { select: { publicToken: true, clientCompanyId: true, setor: { select: { companyId: true } } } },
    },
  });
  if (!task || task.projectId !== id) return new NextResponse("Não encontrado", { status: 404 });

  const token = req.nextUrl.searchParams.get("t");
  let asClient = !!token && !!task.project.publicToken && token === task.project.publicToken;
  if (!asClient) {
    const session = await getEffectiveSession();
    if (!session) return new NextResponse("Não autorizado", { status: 401 });
    const role = (session.user as any).role as string | undefined;
    const companyId = (session.user as any).companyId as string | undefined;
    const isTeam = role === "SUPER_ADMIN" || (!!companyId && companyId === task.project.setor.companyId);
    if (!isTeam) {
      if (!companyId || companyId !== task.project.clientCompanyId) {
        return new NextResponse("Não autorizado", { status: 403 });
      }
      asClient = true;
    }
  }

  if (asClient && (!task.visibleToClient || task.ignoredAt || !fileVisibleToClient(task.comments, fileId))) {
    return new NextResponse("Não encontrado", { status: 404 });
  }

  const download = req.nextUrl.searchParams.get("download") === "1" || !INLINE_OK.test(obj.mimeType);
  const url = await presignDownload(obj.key, obj.fileName, { download });
  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
