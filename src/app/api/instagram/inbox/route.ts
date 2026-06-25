import { NextRequest, NextResponse } from "next/server";
import { requireInstagramCompany } from "@/lib/instagram-api";
import { prisma } from "@/lib/prisma";

// GET /api/instagram/inbox?filter=needsReply → conversas de DM da empresa.
export async function GET(req: NextRequest) {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;

  const needsReply = new URL(req.url).searchParams.get("filter") === "needsReply";

  const conversations = await prisma.igConversation.findMany({
    where: { companyId: ctx.companyId, ...(needsReply ? { needsReply: true } : {}) },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    select: {
      id: true,
      channel: true,
      participantId: true,
      participantUsername: true,
      lastMessageText: true,
      lastMessageAt: true,
      lastDirection: true,
      needsReply: true,
      hadAutomation: true,
    },
  });

  const pending = await prisma.igConversation.count({ where: { companyId: ctx.companyId, needsReply: true } });
  return NextResponse.json({ count: conversations.length, pending, conversations });
}
