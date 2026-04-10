import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/whatsapp/messages?phone=&companyId=
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const { searchParams } = new URL(req.url);
  const phone = searchParams.get("phone");
  const companyId = searchParams.get("companyId");

  if (!phone) return NextResponse.json({ error: "phone é obrigatório" }, { status: 400 });

  const effectiveCompanyId = userRole === "SUPER_ADMIN" ? companyId : userCompanyId;

  const where: any = { phone };
  if (effectiveCompanyId) where.companyId = effectiveCompanyId;

  const messages = await prisma.message.findMany({
    where,
    orderBy: { receivedAt: "asc" },
    include: {
      instance: { select: { instanceName: true } },
      campaign: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(messages);
}
