import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/whatsapp?companyId=
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");

  const effectiveCompanyId =
    userRole === "SUPER_ADMIN" ? companyId : userCompanyId;

  const where = effectiveCompanyId ? { companyId: effectiveCompanyId } : {};

  const instances = await prisma.whatsappInstance.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { company: { select: { id: true, name: true } } },
  });

  return NextResponse.json(instances);
}

// POST /api/whatsapp
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const body = await req.json();
  const { instanceName, phone, webhookUrl, companyId } = body;

  if (!instanceName) {
    return NextResponse.json({ error: "Nome da instância é obrigatório" }, { status: 400 });
  }

  const effectiveCompanyId =
    userRole === "SUPER_ADMIN" ? companyId : userCompanyId;

  if (!effectiveCompanyId) {
    return NextResponse.json({ error: "Empresa não informada" }, { status: 400 });
  }

  const instance = await prisma.whatsappInstance.create({
    data: {
      instanceName,
      phone,
      webhookUrl,
      companyId: effectiveCompanyId,
      status: "DISCONNECTED",
    },
    include: { company: { select: { id: true, name: true } } },
  });

  return NextResponse.json(instance, { status: 201 });
}
