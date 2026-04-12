import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { phone, companyId, leadId } = await req.json();
  if (!phone || !companyId || !leadId) {
    return NextResponse.json({ error: "phone, companyId e leadId são obrigatórios" }, { status: 400 });
  }

  // Verify the lead exists and belongs to this company
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId },
  });
  if (!lead) {
    return NextResponse.json({ error: "Prospect não encontrado" }, { status: 404 });
  }

  // Link all messages from this phone/company to the prospect
  const updated = await prisma.message.updateMany({
    where: { phone, companyId },
    data: { leadId },
  });

  // Also update the lead's phone if it doesn't have one
  if (!lead.phone || lead.phone === phone) {
    // phone is already set or matches — no action needed
  } else if (!lead.phone) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { phone },
    });
  }

  return NextResponse.json({ linked: updated.count });
}
