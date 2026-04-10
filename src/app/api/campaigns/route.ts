import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/campaigns?companyId=xxx
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId");

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  // Clientes só podem ver campanhas da própria empresa
  if (userRole !== "SUPER_ADMIN" && userCompanyId !== companyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const where = companyId ? { companyId } : {};

  const campaigns = await prisma.campaign.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { leads: true, messages: true, links: true } },
    },
  });

  return NextResponse.json(campaigns);
}

// POST /api/campaigns
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const isSuperAdmin = (session.user as any).role === "SUPER_ADMIN";
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const body = await request.json();
  const { name, companyId: bodyCompanyId, description, source, status, budget, startDate, endDate } = body;

  // CLIENT usa a própria empresa; SUPER_ADMIN pode especificar qualquer uma
  const companyId = isSuperAdmin ? bodyCompanyId : userCompanyId;

  if (!name || !companyId) {
    return NextResponse.json({ error: "Nome e empresa são obrigatórios" }, { status: 400 });
  }

  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const existing = await prisma.campaign.findUnique({
    where: { companyId_slug: { companyId, slug } },
  });
  const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

  const campaign = await prisma.campaign.create({
    data: {
      name,
      slug: finalSlug,
      companyId,
      description: description || null,
      source: source ?? "OTHER",
      status: status ?? "ACTIVE",
      budget: budget ? parseFloat(budget) : undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    },
  });

  return NextResponse.json(campaign, { status: 201 });
}
