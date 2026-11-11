import { NextRequest, NextResponse } from "next/server";
import { requireInstagramCompany } from "@/lib/instagram-api";
import { prisma } from "@/lib/prisma";
import type { IgAiReplyStatus } from "@/generated/prisma";

const STATUSES: IgAiReplyStatus[] = ["QUEUED", "AWAITING_APPROVAL", "SCHEDULED", "SENT", "NEEDS_YOU", "SKIPPED", "HIDDEN", "FAILED"];

// GET /api/instagram/ai-replies?automationId=...&status=AWAITING_APPROVAL
// → itens da fila da IA + contagem por status (pras abas do painel).
export async function GET(req: NextRequest) {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;

  const automationId = req.nextUrl.searchParams.get("automationId");
  if (!automationId) return NextResponse.json({ error: "automationId obrigatório" }, { status: 400 });
  const raw = req.nextUrl.searchParams.get("status") as IgAiReplyStatus | null;
  const status = raw && STATUSES.includes(raw) ? raw : "AWAITING_APPROVAL";

  const where = { companyId: ctx.companyId, automationId };
  const [items, grouped] = await Promise.all([
    prisma.igAiReply.findMany({
      where: { ...where, status },
      orderBy: status === "SENT" ? [{ sentAt: "desc" }] : [{ likeCount: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        username: true,
        commentText: true,
        likeCount: true,
        intent: true,
        reason: true,
        replyText: true,
        status: true,
        scheduledAt: true,
        sentAt: true,
        errorDetail: true,
        source: true,
        createdAt: true,
      },
    }),
    prisma.igAiReply.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);
  const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  return NextResponse.json({ items, counts });
}
