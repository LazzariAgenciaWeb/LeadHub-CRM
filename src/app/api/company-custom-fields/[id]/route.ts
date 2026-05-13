import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// DELETE /api/company-custom-fields/[id]
// Remove a definição e (via cascade) todos os valores em todas as empresas
// que tinham este campo preenchido.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const def = await prisma.companyCustomFieldDef.findUnique({
    where: { id },
    select: { ownerCompanyId: true },
  });
  if (!def) return NextResponse.json({ error: "Campo não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && def.ownerCompanyId !== userCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.companyCustomFieldDef.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
