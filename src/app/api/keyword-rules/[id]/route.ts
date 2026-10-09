import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// PATCH /api/keyword-rules/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { keyword, mapTo, matchMode, priority, campaignId } = body;

  const rule = await prisma.keywordRule.update({
    where: { id },
    data: {
      keyword: keyword ? keyword.trim().toLowerCase() : undefined,
      mapTo,
      matchMode: matchMode === "CONTAINS" || matchMode === "EXACT" ? matchMode : undefined,
      priority,
      campaignId: campaignId !== undefined ? (campaignId || null) : undefined,
    },
    include: { campaign: { select: { id: true, name: true } } },
  });

  return NextResponse.json(rule);
}

// DELETE /api/keyword-rules/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  await prisma.keywordRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
