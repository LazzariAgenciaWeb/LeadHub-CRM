import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/integrations/instagram/admin/automations/delete?id=AUTOMATION_ID
// Apaga uma automação (e seus runs por cascade). Apenas SUPER_ADMIN.
export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if ((session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Apenas SUPER_ADMIN" }, { status: 403 });
  }

  const automation = await prisma.igAutomation.findUnique({
    where: { id },
    select: { id: true, name: true, accountId: true },
  });
  if (!automation) return NextResponse.json({ error: "Automação não encontrada" }, { status: 404 });

  await prisma.igAutomation.delete({ where: { id } });
  return NextResponse.json({ ok: true, deleted: automation });
}
