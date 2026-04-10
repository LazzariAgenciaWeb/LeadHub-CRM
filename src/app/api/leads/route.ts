import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/leads?companyId=&status=&campaignId=&search=&page=&limit=
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  const status = searchParams.get("status");
  const campaignId = searchParams.get("campaignId");
  const search = searchParams.get("search");
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = parseInt(searchParams.get("limit") ?? "50");

  // Clientes só veem os próprios leads
  const effectiveCompanyId =
    userRole === "SUPER_ADMIN" ? companyId : userCompanyId;

  const where: any = {};
  if (effectiveCompanyId) where.companyId = effectiveCompanyId;
  if (status) where.status = status;
  if (campaignId) where.campaignId = campaignId;
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { phone: { contains: search } },
      { email: { contains: search } },
    ];
  }

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        company: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  return NextResponse.json({ leads, total, page, limit });
}

// POST /api/leads
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;
  const body = await req.json();
  const { name, phone, email, source, status, notes, value, companyId, campaignId } = body;

  if (!phone) {
    return NextResponse.json({ error: "Telefone é obrigatório" }, { status: 400 });
  }

  const effectiveCompanyId =
    userRole === "SUPER_ADMIN" ? companyId : userCompanyId;

  if (!effectiveCompanyId) {
    return NextResponse.json({ error: "Empresa não informada" }, { status: 400 });
  }

  const lead = await prisma.lead.create({
    data: {
      name,
      phone,
      email,
      source,
      status: status ?? "NEW",
      notes,
      value,
      companyId: effectiveCompanyId,
      campaignId: campaignId || null,
    },
    include: {
      company: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(lead, { status: 201 });
}
