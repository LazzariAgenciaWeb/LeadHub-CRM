import { NextRequest, NextResponse } from "next/server";
import { requireInstagramCompany } from "@/lib/instagram-api";
import { prisma } from "@/lib/prisma";

// GET /api/instagram/runs?automationId=X → disparos da empresa (ou de 1 automação).
export async function GET(req: NextRequest) {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;

  const automationId = new URL(req.url).searchParams.get("automationId");

  const runs = await prisma.igAutomationRun.findMany({
    where: { companyId: ctx.companyId, ...(automationId ? { automationId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      igCommenterId: true,
      username: true,
      commentText: true,
      mediaId: true,
      status: true,
      followState: true,
      leadId: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ count: runs.length, runs });
}
