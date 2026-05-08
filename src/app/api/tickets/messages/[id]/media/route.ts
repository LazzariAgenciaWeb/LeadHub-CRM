import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/tickets/messages/[id]/media
 *
 * Devolve o binário (imagem/áudio) decodificado da TicketMessage.mediaBase64.
 * Mesmo padrão do /api/whatsapp/messages/[id]/media — UI usa esta URL como
 * `<img src>` e o browser baixa só quando renderiza, cacheando localmente.
 *
 * Auth: precisa estar logado e ser da mesma empresa do ticket
 * (SUPER_ADMIN passa direto).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return new NextResponse("Não autorizado", { status: 401 });

  const userRole      = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const { id } = await params;
  const msg = await prisma.ticketMessage.findUnique({
    where:  { id },
    select: {
      mediaBase64: true,
      mediaType:   true,
      ticket:      { select: { companyId: true } },
    },
  });

  if (!msg)             return new NextResponse("Não encontrado", { status: 404 });
  if (!msg.mediaBase64) return new NextResponse("Sem mídia",      { status: 404 });

  if (userRole !== "SUPER_ADMIN" && msg.ticket.companyId !== userCompanyId) {
    return new NextResponse("Não autorizado", { status: 403 });
  }

  const buf = Buffer.from(msg.mediaBase64, "base64");
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type":   msg.mediaType ?? "application/octet-stream",
      "Content-Length": String(buf.byteLength),
      "Cache-Control":  "private, max-age=31536000, immutable",
    },
  });
}
