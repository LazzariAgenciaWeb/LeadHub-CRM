import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { presignDownload, deleteObject } from "@/lib/storage/s3";
import { authorizeTarget, targetOf, isManager } from "@/lib/storage/access";

// Tipos que o navegador pode abrir direto (preview). O resto sempre baixa —
// evita HTML/script servido inline a partir do domínio do storage.
const INLINE_OK = /^(image\/(png|jpe?g|gif|webp|avif)|application\/pdf|video\/(mp4|webm|quicktime)|audio\/[\w.+-]+|text\/plain)$/i;

async function load(session: any, id: string) {
  const obj = await prisma.storageObject.findUnique({ where: { id } });
  if (!obj || obj.status === "PENDING") return { error: "Arquivo não encontrado", status: 404 as const };
  const target = targetOf(obj);
  if (!target) return { error: "Arquivo sem vínculo", status: 404 as const };
  const auth = await authorizeTarget(session, target);
  if (!auth.ok) return { error: auth.error, status: auth.status };
  return { obj };
}

// GET /api/storage/[id]            → abre (preview quando seguro)
// GET /api/storage/[id]?download=1 → força download
// Redireciona pra uma URL assinada de curta duração no MinIO.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const r = await load(session, id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });

  const download = req.nextUrl.searchParams.get("download") === "1" || !INLINE_OK.test(r.obj.mimeType);
  const url = await presignDownload(r.obj.key, r.obj.fileName, { download });
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
  if (!isManager(session) && r.obj.uploadedById !== userId) {
    return NextResponse.json({ error: "Só quem enviou ou um gestor pode excluir" }, { status: 403 });
  }

  await deleteObject(r.obj.key);
  await prisma.storageObject.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
