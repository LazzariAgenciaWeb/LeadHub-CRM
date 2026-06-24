import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/integrations/instagram/admin/automations/create
//   ?accountId=Y&name=...&mediaId=...&triggerType=KEYWORD|ANY
//   &keywords=quero,preço&reply=Te chamei no direct!|Olha lá 👀
//   &dmText=Aqui está o link&dmLink=https://...&requireFollow=0
//
// Cria uma automação de teste sem UI. Apenas SUPER_ADMIN. (UI real = Fase 4.)
// keywords e reply são separados por vírgula e por | respectivamente.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = url.searchParams;
  const accountId = q.get("accountId");
  if (!accountId) return NextResponse.json({ error: "accountId obrigatório" }, { status: 400 });

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if ((session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Apenas SUPER_ADMIN" }, { status: 403 });
  }

  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountId },
    select: { id: true, companyId: true },
  });
  if (!account) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });

  const triggerType = q.get("triggerType") === "ANY" ? "ANY" : "KEYWORD";
  const keywords = (q.get("keywords") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const commentReplies = (q.get("reply") ?? "")
    .split("|").map((s) => s.trim()).filter(Boolean);
  const dmText = q.get("dmText") || null;
  const dmLinkUrl = q.get("dmLink") || null;

  const automation = await prisma.igAutomation.create({
    data: {
      companyId: account.companyId,
      accountId: account.id,
      name: q.get("name") || "Automação de teste",
      enabled: true,
      mediaId: q.get("mediaId") || null,
      triggerType,
      keywords,
      replyToComment: commentReplies.length > 0,
      commentReplies,
      sendDm: !!(dmText || dmLinkUrl),
      dmText,
      dmLinkUrl,
      requireFollow: q.get("requireFollow") === "1",
      notFollowingText: q.get("notFollowingText") || null,
    },
  });

  return NextResponse.json({ ok: true, automation });
}
