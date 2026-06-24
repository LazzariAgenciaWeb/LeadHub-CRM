import { NextRequest, NextResponse } from "next/server";
import { requireInstagramCompany } from "@/lib/instagram-api";
import { prisma } from "@/lib/prisma";

async function ownAutomation(companyId: string, id: string) {
  const a = await prisma.igAutomation.findUnique({ where: { id }, select: { id: true, companyId: true } });
  return a && a.companyId === companyId ? a : null;
}

// PATCH /api/instagram/automations/[id] → edita campos da automação.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;
  const { id } = await params;
  if (!(await ownAutomation(ctx.companyId, id))) {
    return NextResponse.json({ error: "Automação não encontrada" }, { status: 404 });
  }

  const b = await req.json().catch(() => ({}));
  const data: any = {};
  if (b.name !== undefined) data.name = String(b.name).slice(0, 120);
  if (b.enabled !== undefined) data.enabled = !!b.enabled;
  if (b.mediaId !== undefined) data.mediaId = b.mediaId || null;
  if (b.mediaLabel !== undefined) data.mediaLabel = b.mediaLabel || null;
  if (b.triggerType !== undefined) data.triggerType = b.triggerType === "ANY" ? "ANY" : "KEYWORD";
  if (Array.isArray(b.keywords)) data.keywords = b.keywords.map((s: any) => String(s).trim()).filter(Boolean);
  if (b.replyToComment !== undefined) data.replyToComment = !!b.replyToComment;
  if (Array.isArray(b.commentReplies)) data.commentReplies = b.commentReplies.map((s: any) => String(s).trim()).filter(Boolean);
  if (b.sendDm !== undefined) data.sendDm = !!b.sendDm;
  if (b.dmText !== undefined) data.dmText = b.dmText || null;
  if (b.dmLinkUrl !== undefined) data.dmLinkUrl = b.dmLinkUrl || null;
  if (b.dmButtonLabel !== undefined) data.dmButtonLabel = b.dmButtonLabel || null;
  if (b.deliveredText !== undefined) data.deliveredText = b.deliveredText || null;
  if (b.requireFollow !== undefined) data.requireFollow = !!b.requireFollow;
  if (b.notFollowingText !== undefined) data.notFollowingText = b.notFollowingText || null;

  const automation = await prisma.igAutomation.update({ where: { id }, data });
  return NextResponse.json({ ok: true, automation });
}

// DELETE /api/instagram/automations/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;
  const { id } = await params;
  if (!(await ownAutomation(ctx.companyId, id))) {
    return NextResponse.json({ error: "Automação não encontrada" }, { status: 404 });
  }
  await prisma.igAutomation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
