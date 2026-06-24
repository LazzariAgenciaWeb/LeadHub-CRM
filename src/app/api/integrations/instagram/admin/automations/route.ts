import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/integrations/instagram/admin/automations?accountId=Y
// Lista as automações de uma conta. Apenas SUPER_ADMIN.
export async function GET(req: NextRequest) {
  const accountId = new URL(req.url).searchParams.get("accountId");
  if (!accountId) return NextResponse.json({ error: "accountId obrigatório" }, { status: 400 });

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if ((session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Apenas SUPER_ADMIN" }, { status: 403 });
  }

  const automations = await prisma.igAutomation.findMany({
    where: { accountId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ count: automations.length, automations });
}
