import { NextRequest, NextResponse } from "next/server";
import { requireInstagramCompany } from "@/lib/instagram-api";
import { prisma } from "@/lib/prisma";

// GET /api/instagram/inbox/[id] → conversa + mensagens.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;
  const { id } = await params;

  const convo = await prisma.igConversation.findUnique({
    where: { id },
    select: {
      id: true,
      companyId: true,
      participantId: true,
      participantUsername: true,
      needsReply: true,
      hadAutomation: true,
    },
  });
  if (!convo || convo.companyId !== ctx.companyId) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

  const messages = await prisma.igMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { id: true, direction: true, source: true, text: true, createdAt: true },
  });

  return NextResponse.json({ conversation: convo, messages });
}
