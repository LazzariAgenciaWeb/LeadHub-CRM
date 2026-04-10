import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// PATCH /api/keyword-rules/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { keyword, mapTo, priority, campaignId } = body;

  const rule = await prisma.keywordRule.update({
    where: { id },
    data: {
      keyword: keyword ? keyword.trim().toLowerCase() : undefined,
      mapTo,
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
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  await prisma.keywordRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
