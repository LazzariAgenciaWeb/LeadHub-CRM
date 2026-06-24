import { NextRequest, NextResponse } from "next/server";
import { requireInstagramCompany, getCompanyAccount } from "@/lib/instagram-api";
import { prisma } from "@/lib/prisma";

// GET /api/instagram/automations → lista as automações da empresa.
export async function GET() {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;

  const automations = await prisma.igAutomation.findMany({
    where: { companyId: ctx.companyId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ count: automations.length, automations });
}

// POST /api/instagram/automations → cria automação.
export async function POST(req: NextRequest) {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;

  const account = await getCompanyAccount(ctx.companyId);
  if (!account) return NextResponse.json({ error: "Conecte uma conta do Instagram primeiro" }, { status: 400 });

  const b = await req.json().catch(() => ({}));
  const keywords: string[] = Array.isArray(b.keywords)
    ? b.keywords.map((s: any) => String(s).trim()).filter(Boolean)
    : [];
  const commentReplies: string[] = Array.isArray(b.commentReplies)
    ? b.commentReplies.map((s: any) => String(s).trim()).filter(Boolean)
    : [];

  const automation = await prisma.igAutomation.create({
    data: {
      companyId: ctx.companyId,
      accountId: account.id,
      name: String(b.name || "Sem nome").slice(0, 120),
      enabled: b.enabled !== false,
      mediaId: b.mediaId || null,
      mediaLabel: b.mediaLabel || null,
      triggerType: b.triggerType === "ANY" ? "ANY" : "KEYWORD",
      keywords,
      replyToComment: !!b.replyToComment,
      commentReplies,
      sendDm: !!b.sendDm,
      dmText: b.dmText || null,
      dmLinkUrl: b.dmLinkUrl || null,
      requireFollow: !!b.requireFollow,
      notFollowingText: b.notFollowingText || null,
    },
  });
  return NextResponse.json({ ok: true, automation });
}
