import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

// POST /api/email/campaigns/[id]/resume  → PAUSED → SENDING
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const c = await prisma.emailCampaign.findUnique({ where: { id }, select: { companyId: true, status: true } });
  if (!c) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && c.companyId !== userCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (c.status !== "PAUSED") return NextResponse.json({ error: "Só pode retomar campanhas pausadas" }, { status: 409 });

  await prisma.emailCampaign.update({ where: { id }, data: { status: "SENDING" } });
  return NextResponse.json({ ok: true });
}
