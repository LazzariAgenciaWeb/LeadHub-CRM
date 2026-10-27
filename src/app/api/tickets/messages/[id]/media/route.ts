import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/tickets/messages/[id]/media
 *
 * Devolve o binário (imagem/áudio) decodificado da TicketMessage.mediaBase64.
 * Mesmo padrão do /api/whatsapp/messages/[id]/media — UI usa esta URL como
 * `<img src>` e o browser baixa só quando renderiza, cacheando localmente.
 *
 * Auth: precisa estar logado e ser da mesma empresa do ticket
 * (SUPER_ADMIN passa direto) — ou ser o CLIENTE do chamado (Meu Espaço), desde
 * que nem o chamado nem a mensagem sejam internos.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // ?t=<publicToken>: página pública /acompanhar do chamado, sem login.
  const token = req.nextUrl.searchParams.get("t");
  const session = token ? null : await getEffectiveSession();
  if (!token && !session) return new NextResponse("Não autorizado", { status: 401 });

  const userRole      = (session?.user as any)?.role;
  const userCompanyId = (session?.user as any)?.companyId;

  const msg = await prisma.ticketMessage.findUnique({
    where:  { id },
    select: {
      mediaBase64: true,
      mediaType:   true,
      isInternal:  true,
      ticket:      { select: { companyId: true, clientCompanyId: true, isInternal: true, publicToken: true } },
    },
  });

  if (!msg)             return new NextResponse("Não encontrado", { status: 404 });
  if (!msg.mediaBase64) return new NextResponse("Sem mídia",      { status: 404 });

  if (token) {
    if (!msg.ticket.publicToken || msg.ticket.publicToken !== token || msg.isInternal) {
      return new NextResponse("Não autorizado", { status: 403 });
    }
  } else {
    const isClientOfTicket = !!userCompanyId && msg.ticket.clientCompanyId === userCompanyId
      && !msg.ticket.isInternal && !msg.isInternal;
    if (userRole !== "SUPER_ADMIN" && msg.ticket.companyId !== userCompanyId && !isClientOfTicket) {
      return new NextResponse("Não autorizado", { status: 403 });
    }
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
