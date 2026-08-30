import { NextRequest, NextResponse } from "next/server";
import { requireInstagramCompany } from "@/lib/instagram-api";
import { prisma } from "@/lib/prisma";
import { decryptAccountToken, getIgUserProfile } from "@/lib/instagram";

// GET /api/instagram/inbox/[id] → conversa + mensagens.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;
  const { id } = await params;

  let convo = await prisma.igConversation.findUnique({
    where: { id },
    select: {
      id: true,
      companyId: true,
      channel: true,
      accountId: true,
      participantId: true,
      participantUsername: true,
      needsReply: true,
      hadAutomation: true,
      aiMode: true,
    },
  });
  if (!convo || convo.companyId !== ctx.companyId) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

  // Backfill do @username quando a conversa IG só tem o ID (best-effort).
  if (convo.channel === "INSTAGRAM" && convo.accountId && !convo.participantUsername) {
    const account = await prisma.instagramAccount.findUnique({ where: { id: convo.accountId }, select: { accessTokenEnc: true } });
    const token = decryptAccountToken(account?.accessTokenEnc);
    if (token) {
      const prof = await getIgUserProfile(convo.participantId, token);
      const uname = prof.username ?? prof.name ?? null;
      if (uname) {
        await prisma.igConversation.update({ where: { id }, data: { participantUsername: uname } });
        convo = { ...convo, participantUsername: uname };
      }
    }
  }

  const messages = await prisma.igMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { id: true, direction: true, source: true, text: true, createdAt: true },
  });

  return NextResponse.json({ conversation: convo, messages });
}

// PATCH /api/instagram/inbox/[id] { aiMode } → liga/pausa/desliga o agente IA
// do Direct nesta conversa.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;
  const { id } = await params;

  const convo = await prisma.igConversation.findUnique({ where: { id }, select: { companyId: true } });
  if (!convo || convo.companyId !== ctx.companyId) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

  const aiMode = String((await req.json().catch(() => ({})))?.aiMode || "");
  if (!["ACTIVE", "PAUSED_HUMAN", "OFF"].includes(aiMode)) {
    return NextResponse.json({ error: "aiMode inválido" }, { status: 400 });
  }

  await prisma.igConversation.update({ where: { id }, data: { aiMode: aiMode as any } });
  if (aiMode !== "ACTIVE") {
    const { cancelIgAutoAgent } = await import("@/lib/ig-auto-agent");
    cancelIgAutoAgent(id);
  }
  return NextResponse.json({ ok: true, aiMode });
}
