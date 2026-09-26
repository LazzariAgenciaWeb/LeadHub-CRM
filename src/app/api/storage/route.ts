import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { storageEnabled, presignUpload, MAX_FILE_BYTES, S3_BUCKET } from "@/lib/storage/s3";
import { authorizeTarget, parseTarget, validateFileName, safeKeyName, isManager } from "@/lib/storage/access";

const PUBLIC_FIELDS = {
  id: true, fileName: true, mimeType: true, size: true, createdAt: true,
  ticketMessageId: true, uploadedById: true,
  uploadedBy: { select: { name: true } },
} as const;

// GET /api/storage?ticketId=… | ?projectTaskId=…
// Lista os arquivos prontos do chamado (inclui os que vieram por mensagem) ou da tarefa.
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const target = parseTarget({
    ticketId: sp.get("ticketId"), projectTaskId: sp.get("projectTaskId"), libraryCompanyId: sp.get("libraryCompanyId"),
  });
  if (!target) return NextResponse.json({ error: "Informe ticketId ou projectTaskId" }, { status: 400 });

  const auth = await authorizeTarget(session, target);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // Biblioteca é listada por /api/biblioteca (respeita "cliente vê").
  if (target.kind === "library") return NextResponse.json({ error: "Use /api/biblioteca" }, { status: 400 });

  const files = await prisma.storageObject.findMany({
    where: {
      status: "READY",
      ...(target.kind === "ticket" ? { ticketId: target.ticketId } : { projectTaskId: target.projectTaskId }),
    },
    select: PUBLIC_FIELDS,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    files,
    enabled: storageEnabled(),
    me: { id: (session.user as any)?.id ?? null, manager: isManager(session) },
  });
}

// POST /api/storage
// Body: { ticketId | projectTaskId, fileName, mimeType, size, draft? }
// Registra o arquivo (PENDING) e devolve a URL assinada pro browser subir
// direto no MinIO. Depois o browser chama POST /api/storage/[id]/complete.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!storageEnabled()) {
    return NextResponse.json({ error: "Armazenamento de arquivos não configurado" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const target = parseTarget(body);
  if (!target) return NextResponse.json({ error: "Informe ticketId ou projectTaskId" }, { status: 400 });

  const fileName = String(body.fileName ?? "").trim().slice(0, 255);
  const mimeType = String(body.mimeType || "application/octet-stream").slice(0, 150);
  const size = Number(body.size ?? 0);
  if (!fileName) return NextResponse.json({ error: "Nome do arquivo obrigatório" }, { status: 400 });
  const invalid = validateFileName(fileName);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  if (!(size > 0)) return NextResponse.json({ error: "Arquivo vazio" }, { status: 400 });
  if (size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `Arquivo acima do limite de ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB` },
      { status: 413 },
    );
  }
  // Rascunho (composer da conversa) só faz sentido em chamado.
  const draft = !!body.draft && target.kind === "ticket";

  const auth = await authorizeTarget(session, target, { write: true });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const id = randomUUID();
  const folder =
    target.kind === "ticket" ? `tickets/${target.ticketId}`
    : target.kind === "library" ? `library/${target.libraryCompanyId}`
    : `project-tasks/${target.projectTaskId}`;
  const key = `companies/${auth.companyId}/${folder}/${id}/${safeKeyName(fileName)}`;

  const obj = await prisma.storageObject.create({
    data: {
      companyId: auth.companyId,
      bucket: S3_BUCKET,
      key,
      fileName,
      mimeType,
      size,
      status: "PENDING",
      ticketId: target.kind === "ticket" ? target.ticketId : null,
      projectTaskId: target.kind === "projectTask" ? target.projectTaskId : null,
      libraryCompanyId: target.kind === "library" ? target.libraryCompanyId : null,
      uploadedById: (session.user as any)?.id ?? null,
    },
    select: { id: true },
  });

  const { url, fields } = await presignUpload(key, mimeType);
  return NextResponse.json({ id: obj.id, url, fields, draft }, { status: 201 });
}
