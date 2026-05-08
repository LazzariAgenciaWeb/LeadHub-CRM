import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/whatsapp/messages/[id]/media
 *
 * Devolve o binário (imagem/áudio) decodificado da Message.mediaBase64.
 * O endpoint de listagem NÃO inclui mais o base64 inline — a UI usa esta
 * URL como `<img src>` / `<audio src>` e o browser baixa só quando renderiza,
 * cacheando localmente. Evita o pico de memória de 20MB+ por conversa em
 * grupos com muitas imagens.
 *
 * Auth: precisa estar logado e ser da mesma empresa da mensagem
 * (SUPER_ADMIN passa direto).
 *
 * Cache: imutável (id é único — mesmo que a mensagem mude o externalId é fixo).
 * `private` pra não cachear em proxies compartilhados.
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
  const msg = await prisma.message.findUnique({
    where:  { id },
    select: { mediaBase64: true, mediaType: true, companyId: true },
  });

  if (!msg)              return new NextResponse("Não encontrado", { status: 404 });
  if (!msg.mediaBase64)  return new NextResponse("Sem mídia",      { status: 404 });

  if (userRole !== "SUPER_ADMIN" && msg.companyId !== userCompanyId) {
    return new NextResponse("Não autorizado", { status: 403 });
  }

  const buf = Buffer.from(msg.mediaBase64, "base64");
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type":   msg.mediaType ?? "application/octet-stream",
      "Content-Length": String(buf.byteLength),
      // 1 ano, immutable — id é único e mediaBase64 não muda em update.
      "Cache-Control":  "private, max-age=31536000, immutable",
    },
  });
}
