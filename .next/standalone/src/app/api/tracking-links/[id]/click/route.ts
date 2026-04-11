import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/tracking-links/[id]/click — público, sem auth
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.trackingLink.update({
    where: { id },
    data: { clicks: { increment: 1 } },
  }).catch(() => {});
  return NextResponse.json({ ok: true });
}
