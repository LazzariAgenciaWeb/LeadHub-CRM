import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { ticketByPublicToken } from "@/lib/ticket-public";
import { storageEnabled, presignUpload, MAX_FILE_BYTES, S3_BUCKET } from "@/lib/storage/s3";
import { validateFileName, safeKeyName } from "@/lib/storage/access";

// Teto de rascunhos pendentes por chamado vindos do link público — o link é
// secreto, mas não tem login: evita que um link virasse depósito de arquivo.
const MAX_DRAFTS = 20;

// POST /api/acompanhar/[token]/arquivos
// Body: { fileName, mimeType, size }
//
// Anexo do CLIENTE no link público do chamado (print do erro, comprovante…).
// Mesmo fluxo de /api/storage: grava PENDING e devolve a URL assinada pro
// browser subir direto no MinIO; depois o browser confirma em
// …/arquivos/[fileId]/complete e o arquivo fica DRAFT até ir numa mensagem.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ticket = await ticketByPublicToken(token);
  if (!ticket) return NextResponse.json({ error: "Link inválido ou expirado" }, { status: 404 });

  if (!storageEnabled()) {
    return NextResponse.json({ error: "Armazenamento de arquivos não configurado" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
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

  const pendentes = await prisma.storageObject.count({
    where: { ticketId: ticket.id, uploadedById: null, status: { in: ["PENDING", "DRAFT"] } },
  });
  if (pendentes >= MAX_DRAFTS) {
    return NextResponse.json({ error: "Muitos arquivos aguardando envio. Mande a mensagem antes de anexar mais." }, { status: 429 });
  }

  const id = randomUUID();
  // Arquivo conta na empresa dona do chamado (a agência), como no /api/storage.
  const key = `companies/${ticket.companyId}/tickets/${ticket.id}/${id}/${safeKeyName(fileName)}`;

  const obj = await prisma.storageObject.create({
    data: {
      companyId: ticket.companyId,
      bucket:    S3_BUCKET,
      key,
      fileName,
      mimeType,
      size,
      status:    "PENDING",
      ticketId:  ticket.id,
      // Sem usuário: é o cliente pelo link. É isso que marca o rascunho como
      // dele — a rota da mensagem só aceita anexo com uploadedById null.
      uploadedById: null,
    },
    select: { id: true },
  });

  const { url, fields } = await presignUpload(key, mimeType);
  return NextResponse.json({ id: obj.id, url, fields, draft: true }, { status: 201 });
}
