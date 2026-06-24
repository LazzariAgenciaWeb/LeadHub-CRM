import { NextResponse } from "next/server";
import { requireInstagramCompany } from "@/lib/instagram-api";
import { prisma } from "@/lib/prisma";

// GET /api/instagram/runs → últimos disparos de automação da empresa.
export async function GET() {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;

  const runs = await prisma.igAutomationRun.findMany({
    where: { companyId: ctx.companyId },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      username: true,
      commentText: true,
      mediaId: true,
      status: true,
      followState: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ count: runs.length, runs });
}
