import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAssistantUser } from "@/lib/personal-assistant/session";

/** GET → usuários da empresa (pra delegar). SUPER_ADMIN fica de fora: não atende cliente da agência. */
export async function GET() {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  const me = await prisma.user.findUnique({ where: { id: auth.userId }, select: { companyId: true } });
  if (!me?.companyId) return NextResponse.json([]);
  const rows = await prisma.user.findMany({
    where: { companyId: me.companyId, role: { not: "SUPER_ADMIN" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(rows);
}
