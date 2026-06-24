import { NextRequest, NextResponse } from "next/server";
import { requireInstagramCompany } from "@/lib/instagram-api";
import { prisma } from "@/lib/prisma";
import { decryptAccountToken, sendMessageToUser, recordIgMessage } from "@/lib/instagram";

// POST /api/instagram/inbox/[id]/reply { text } → atendente responde a conversa.
// Usa a janela de 24h do Instagram (recipient.id). Fora dela, a API recusa.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;
  const { id } = await params;

  const convo = await prisma.igConversation.findUnique({ where: { id } });
  if (!convo || convo.companyId !== ctx.companyId) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const text = String(body.text || "").trim();
  if (!text) return NextResponse.json({ error: "Texto vazio" }, { status: 400 });

  const account = await prisma.instagramAccount.findUnique({
    where: { id: convo.accountId },
    select: { accessTokenEnc: true },
  });
  const token = decryptAccountToken(account?.accessTokenEnc);
  if (!token) return NextResponse.json({ error: "Conta sem token" }, { status: 400 });

  try {
    await sendMessageToUser(convo.participantId, text, token);
  } catch (e: any) {
    // Fora da janela de 24h ou política de mensagem → devolve o erro.
    return NextResponse.json({ error: e?.message?.slice(0, 200) || "Falha ao enviar" }, { status: 502 });
  }

  await recordIgMessage({
    companyId: ctx.companyId,
    accountId: convo.accountId,
    participantId: convo.participantId,
    direction: "OUT",
    source: "AGENT",
    text,
  });

  return NextResponse.json({ ok: true });
}
