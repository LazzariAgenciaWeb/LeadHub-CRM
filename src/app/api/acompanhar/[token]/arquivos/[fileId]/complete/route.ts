import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ticketByPublicToken } from "@/lib/ticket-public";
import { headObjectSize } from "@/lib/storage/s3";

// POST /api/acompanhar/[token]/arquivos/[fileId]/complete
// O browser avisa que terminou de subir. Conferimos no bucket (HEAD) antes de
// marcar o rascunho — o tamanho gravado é o real, não o que o browser declarou.
// Fica DRAFT: só vira anexo quando o cliente manda a mensagem.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string; fileId: string }> },
) {
  const { token, fileId } = await params;
  const ticket = await ticketByPublicToken(token);
  if (!ticket) return NextResponse.json({ error: "Link inválido ou expirado" }, { status: 404 });

  const obj = await prisma.storageObject.findUnique({ where: { id: fileId } });
  if (!obj || obj.status !== "PENDING" || obj.ticketId !== ticket.id || obj.uploadedById) {
    return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });
  }

  const size = await headObjectSize(obj.key);
  if (size === null) return NextResponse.json({ error: "Upload não encontrado no storage" }, { status: 409 });

  const file = await prisma.storageObject.update({
    where:  { id: fileId },
    data:   { size, status: "DRAFT" },
    select: { id: true, fileName: true, mimeType: true, size: true },
  });
  return NextResponse.json(file);
}
