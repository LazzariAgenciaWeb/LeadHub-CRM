import { NextRequest, NextResponse } from "next/server";
import { requireInstagramCompany } from "@/lib/instagram-api";
import { prisma } from "@/lib/prisma";
import { fbTokenCrypto, fbUnsubscribePage } from "@/lib/facebook";

// DELETE /api/instagram/facebook-pages/[id] → remove uma Página conectada da empresa.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;
  const { id } = await params;

  const page = await prisma.facebookPage.findUnique({
    where: { id },
    select: { id: true, companyId: true, pageId: true, pageAccessTokenEnc: true },
  });
  if (!page || page.companyId !== ctx.companyId) {
    return NextResponse.json({ error: "Página não encontrada" }, { status: 404 });
  }

  const token = fbTokenCrypto.decrypt(page.pageAccessTokenEnc);
  if (token) await fbUnsubscribePage(page.pageId, token);

  await prisma.facebookPage.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
