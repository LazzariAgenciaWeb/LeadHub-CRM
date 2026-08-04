import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionGetMediaBase64 } from "@/lib/evolution";

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
    select: {
      mediaBase64: true, mediaType: true, companyId: true,
      externalId: true, phone: true, direction: true, participantPhone: true,
      instance: { select: { instanceName: true, instanceToken: true } },
      conversation: { select: { instanceId: true, syncBlocked: true } },
    },
  });

  if (!msg) return new NextResponse("Não encontrado", { status: 404 });

  if (userRole !== "SUPER_ADMIN" && msg.companyId !== userCompanyId) {
    return new NextResponse("Não autorizado", { status: 403 });
  }

  // Visibilidade: conversa de instância privada de outro dono ou bloqueada → nega.
  if (msg.conversation) {
    const { canUserSeeConversation } = await import("@/lib/whatsapp-visibility");
    if (!(await canUserSeeConversation(session, msg.conversation))) {
      return new NextResponse("Não autorizado", { status: 403 });
    }
  }

  let base64 = msg.mediaBase64;
  let mime = msg.mediaType;

  // On-demand: webhook em base64:false não guarda o binário. Se a mensagem é
  // mídia (tem mediaType) mas não tem base64 armazenado, baixa da Evolution
  // agora e cacheia no DB pra próximos acessos (browser cacheia após o 1º hit).
  if (!base64 && msg.mediaType && msg.externalId && msg.instance) {
    const fetched = await evolutionGetMediaBase64(
      msg.instance.instanceName,
      {
        id: msg.externalId,
        remoteJid: msg.phone,
        fromMe: msg.direction === "OUTBOUND",
        participant: msg.participantPhone ?? undefined,
      },
      msg.instance.instanceToken,
    );
    if (fetched?.base64) {
      base64 = fetched.base64;
      mime = fetched.mimetype ?? mime;
      void prisma.message.update({
        where: { id },
        data: { mediaBase64: fetched.base64, ...(fetched.mimetype ? { mediaType: fetched.mimetype } : {}) },
      }).catch(() => {/* cache best-effort */});
    }
  }

  if (!base64) return new NextResponse("Sem mídia", { status: 404 });

  const buf = Buffer.from(base64, "base64");
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type":   mime ?? "application/octet-stream",
      "Content-Length": String(buf.byteLength),
      // 1 ano, immutable — id é único e mediaBase64 não muda em update.
      "Cache-Control":  "private, max-age=31536000, immutable",
    },
  });
}
