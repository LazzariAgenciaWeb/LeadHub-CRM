import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/campaigns/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      keywordRules: { orderBy: [{ priority: "desc" }, { createdAt: "asc" }] },
      _count: { select: { leads: true, messages: true } },
    },
  });

  if (!campaign) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
  if (userRole !== "SUPER_ADMIN" && campaign.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  return NextResponse.json(campaign);
}

// PATCH /api/campaigns/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
  if (userRole !== "SUPER_ADMIN" && campaign.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const { name, description, source, status, budget, startDate, endDate } = body;

  const updated = await prisma.campaign.update({
    where: { id },
    data: {
      name: name ?? undefined,
      description: description ?? undefined,
      source: source ?? undefined,
      status: status ?? undefined,
      budget: budget !== undefined ? (budget ? parseFloat(budget) : null) : undefined,
      startDate: startDate !== undefined ? (startDate ? new Date(startDate) : null) : undefined,
      endDate: endDate !== undefined ? (endDate ? new Date(endDate) : null) : undefined,
    },
  });

  return NextResponse.json(updated);
}

// DELETE /api/campaigns/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;
  await prisma.campaign.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
