import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// DELETE /api/leads/[id]/tags/[tagId] → desanexa tag do lead
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; tagId: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id, tagId } = await params;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const lead = await prisma.lead.findUnique({ where: { id }, select: { companyId: true } });
  if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && lead.companyId !== userCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Não bloqueia se já não existe — operação idempotente.
  await prisma.leadTag
    .delete({ where: { leadId_tagId: { leadId: id, tagId } } })
    .catch(() => null);

  return NextResponse.json({ ok: true });
}
