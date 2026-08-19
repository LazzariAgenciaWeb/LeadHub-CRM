import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionGetMediaBase64 } from "@/lib/evolution";

/**
 * GET /api/whatsapp/messages/[id]/media        → versão leve (thumb/o que há no DB)
 * GET /api/whatsapp/messages/[id]/media?full=1 → versão CHEIA (busca na Evolution)
 *
 * Modelo thumb-first (pós base64:false no webhook):
 *  - O webhook guarda no DB só o que veio leve (jpegThumbnail ~2-10KB, ou áudio).
 *    O feed renderiza isso instantâneo — nunca trava a conversa.
 *  - Clique na imagem → abre ?full=1 em nova guia: buscamos o binário cheio na
 *    Evolution na hora (getBase64FromMediaMessage) e servimos. Nada de blob
 *    gigante no feed.
 *  - Cache no DB: só gravamos o que for razoável (≤ CACHE_MAX_B64_CHARS) pra não
 *    reintroduzir o OOM do Postgres por coluna gigante. Acima disso, serve
 *    direto e deixa o cache do browser (immutable) segurar as próximas.
 *
 * Auth: logado + mesma empresa (SUPER_ADMIN passa) + visibilidade (instância
 * privada / conversa bloqueada).
 */

// ~640KB de base64 ≈ 480KB binário. Thumb sempre cabe; foto de câmera não.
const CACHE_MAX_B64_CHARS = 640_000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return new NextResponse("Não autorizado", { status: 401 });

  const userRole      = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const { id } = await params;
  const wantFull = req.nextUrl.searchParams.get("full") === "1";

  const msg = await prisma.message.findUnique({
    where:  { id },
    select: {
      mediaBase64: true, mediaType: true, companyId: true,
      externalId: true, phone: true, direction: true, participantPhone: true,
      rawPayload: true, // key+message completos → Evolution descriptografa a mídia
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

  // O jpegThumbnail salvo pelo webhook é minúsculo (< ~30KB de base64). Se o
  // que temos no DB é só isso e o cliente pediu a CHEIA, busca na Evolution.
  const storedLooksLikeThumb = !!base64 && base64.length < 40_000;
  const needFetch =
    (!base64 || (wantFull && storedLooksLikeThumb)) &&
    !!msg.mediaType && !!msg.externalId && !!msg.instance;

  if (needFetch && msg.instance && msg.externalId) {
    // rawPayload salvo no webhook: { event, instance, data: { key, message } }
    const raw: any = msg.rawPayload as any;
    const rawData = raw?.data ?? (raw?.key && raw?.message ? raw : undefined);
    const fetched = await evolutionGetMediaBase64(
      msg.instance.instanceName,
      {
        id: msg.externalId,
        remoteJid: msg.phone,
        fromMe: msg.direction === "OUTBOUND",
        participant: msg.participantPhone ?? undefined,
      },
      msg.instance.instanceToken,
      rawData,
    );
    if (fetched?.base64) {
      base64 = fetched.base64;
      mime = fetched.mimetype ?? mime;
      // Cache best-effort no DB — SÓ se couber no cap (não reintroduzir blob
      // gigante no Postgres). Sempre melhora o que está armazenado (thumb→full
      // pequena, nada→algo); nunca substitui por algo pior.
      if (fetched.base64.length <= CACHE_MAX_B64_CHARS) {
        void prisma.message.update({
          where: { id },
          data: { mediaBase64: fetched.base64, ...(fetched.mimetype ? { mediaType: fetched.mimetype } : {}) },
        }).catch(() => {/* não crítico */});
      }
    }
  }

  if (!base64) return new NextResponse("Sem mídia", { status: 404 });

  const buf = Buffer.from(base64, "base64");
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type":   mime ?? "application/octet-stream",
      "Content-Length": String(buf.byteLength),
      // Immutable por variante: a thumb muda pra full no DB, mas cada URL
      // (com/sem ?full=1) devolve conteúdo estável o bastante pro cache local.
      "Cache-Control":  "private, max-age=31536000, immutable",
      // Nova guia mostra a imagem inline (não força download)
      "Content-Disposition": "inline",
    },
  });
}
