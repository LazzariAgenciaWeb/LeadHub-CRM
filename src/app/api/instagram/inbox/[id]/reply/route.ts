import { NextRequest, NextResponse } from "next/server";
import { requireInstagramCompany } from "@/lib/instagram-api";
import { prisma } from "@/lib/prisma";
import { decryptAccountToken, sendMessageToUser, recordIgMessage } from "@/lib/instagram";
import { fbTokenCrypto, fbSendMessage } from "@/lib/facebook";

// POST /api/instagram/inbox/[id]/reply { text } → atendente responde (IG ou Messenger).
// Usa a janela de 24h. Fora dela, a API recusa.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;
  const { id } = await params;

  const convo = await prisma.igConversation.findUnique({ where: { id } });
  if (!convo || convo.companyId !== ctx.companyId) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

  const text = String((await req.json().catch(() => ({})))?.text || "").trim();
  if (!text) return NextResponse.json({ error: "Texto vazio" }, { status: 400 });

  // mid do envio — deduplica contra o echo do webhook (message_echoes).
  let mid: string | null = null;
  try {
    if (convo.channel === "MESSENGER") {
      const page = await prisma.facebookPage.findUnique({
        where: { pageId: convo.connectionId ?? "" },
        select: { pageId: true, pageAccessTokenEnc: true },
      });
      const token = fbTokenCrypto.decrypt(page?.pageAccessTokenEnc);
      if (!page || !token) return NextResponse.json({ error: "Página sem token" }, { status: 400 });
      mid = await fbSendMessage(page.pageId, convo.participantId, text, token);
    } else {
      const account = await prisma.instagramAccount.findUnique({
        where: { id: convo.accountId ?? convo.connectionId ?? "" },
        select: { accessTokenEnc: true },
      });
      const token = decryptAccountToken(account?.accessTokenEnc);
      if (!token) return NextResponse.json({ error: "Conta sem token" }, { status: 400 });
      mid = await sendMessageToUser(convo.participantId, text, token);
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message?.slice(0, 200) || "Falha ao enviar" }, { status: 502 });
  }

  await recordIgMessage({
    companyId: ctx.companyId,
    channel: convo.channel as any,
    connectionId: convo.connectionId ?? convo.accountId ?? convo.participantId,
    accountId: convo.accountId,
    participantId: convo.participantId,
    direction: "OUT",
    source: "AGENT",
    text,
    mid,
  });

  // Atendente assumiu → agente IA do Direct silencia nesta conversa (igual
  // ao padrão do WhatsApp). Reativação pelo toggle da inbox.
  if (convo.aiMode === "ACTIVE") {
    await prisma.igConversation.update({ where: { id: convo.id }, data: { aiMode: "PAUSED_HUMAN" } });
  }
  const { cancelIgAutoAgent } = await import("@/lib/ig-auto-agent");
  cancelIgAutoAgent(convo.id);

  return NextResponse.json({ ok: true });
}
