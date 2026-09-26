import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { copyObject, S3_BUCKET } from "@/lib/storage/s3";
import { authorizeTarget, targetOf, safeKeyName } from "@/lib/storage/access";
import { libraryAccess, normalizeFolder, LIBRARY_ITEM_SELECT } from "@/lib/client-library";

// POST /api/biblioteca/[clientId]/guardar
// Body: { storageObjectId, folder?, title?, description? }
// Guarda um anexo de chamado ou de tarefa na biblioteca do cliente (Meu
// Espaço → Arquivos). Faz uma CÓPIA no MinIO: apagar o chamado/tarefa (que
// leva os anexos em cascata) não pode sumir com o arquivo da biblioteca.
export async function POST(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await getEffectiveSession();
  const { clientId } = await params;
  const acc = await libraryAccess(session, clientId);
  if (!acc.ok) return NextResponse.json({ error: acc.error }, { status: acc.status });
  if (acc.role !== "team") return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const src = await prisma.storageObject.findUnique({ where: { id: String(body?.storageObjectId ?? "") } });
  if (!src || src.status !== "READY") return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });

  const target = targetOf(src);
  if (!target || target.kind === "library") {
    return NextResponse.json({ error: "Esse arquivo já está na biblioteca" }, { status: 400 });
  }
  const auth = await authorizeTarget(session, target);
  if (!auth.ok || auth.asClient) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  // Só guarda na biblioteca do cliente dono do chamado/projeto — evita
  // mandar arquivo de um cliente pra outro por engano.
  const donoId =
    target.kind === "ticket"
      ? (await prisma.ticket.findUnique({ where: { id: target.ticketId }, select: { clientCompanyId: true } }))?.clientCompanyId
      : (await prisma.projectTask.findUnique({
          where: { id: target.projectTaskId },
          select: { project: { select: { clientCompanyId: true } } },
        }))?.project.clientCompanyId;
  if (donoId !== clientId) {
    return NextResponse.json({ error: "Esse anexo não é deste cliente" }, { status: 400 });
  }

  const key = `companies/${acc.agencyId}/library/${clientId}/${randomUUID()}/${safeKeyName(src.fileName)}`;
  try {
    await copyObject(src.key, key);
  } catch {
    return NextResponse.json({ error: "Não foi possível copiar o arquivo" }, { status: 502 });
  }

  const copy = await prisma.storageObject.create({
    data: {
      companyId: acc.agencyId,
      bucket: S3_BUCKET,
      key,
      fileName: src.fileName,
      mimeType: src.mimeType,
      size: src.size,
      status: "READY",
      libraryCompanyId: clientId,
      uploadedById: (session!.user as any)?.id ?? null,
    },
    select: { id: true },
  });

  const item = await prisma.clientLibraryItem.create({
    data: {
      clientCompanyId: clientId,
      kind: "FILE",
      folder: normalizeFolder(body?.folder),
      title: String(body?.title ?? "").trim().slice(0, 200) || src.fileName,
      description: String(body?.description ?? "").trim().slice(0, 2000) || null,
      storageObjectId: copy.id,
      createdById: (session!.user as any)?.id ?? null,
      createdByName: (session!.user as any)?.name ?? null,
    },
    select: LIBRARY_ITEM_SELECT,
  });
  return NextResponse.json({ item }, { status: 201 });
}
