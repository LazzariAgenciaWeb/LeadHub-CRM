import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/companies/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  // Clientes só podem ver a própria empresa
  if (userRole !== "SUPER_ADMIN" && userCompanyId !== id) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      campaigns: { orderBy: { createdAt: "desc" } },
      whatsappInstances: true,
      _count: { select: { leads: true, messages: true } },
    },
  });

  if (!company) {
    return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });
  }

  return NextResponse.json(company);
}

// PATCH /api/companies/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const isSuperAdmin = (session.user as any).role === "SUPER_ADMIN";
  const userCompanyId = (session.user as any).companyId as string | undefined;

  // CLIENT só pode editar a própria empresa
  if (!isSuperAdmin && userCompanyId !== id) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await request.json();
  const { name, segment, phone, email, website, logoUrl, status, triggerOnly } = body;

  // Campos que CLIENT não pode alterar
  const adminOnlyData = isSuperAdmin
    ? { ...(status !== undefined && { status }), ...(triggerOnly !== undefined && { triggerOnly }) }
    : {};

  const company = await prisma.company.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(segment !== undefined && { segment }),
      ...(phone !== undefined && { phone }),
      ...(email !== undefined && { email }),
      ...(website !== undefined && { website }),
      ...(logoUrl !== undefined && { logoUrl }),
      ...adminOnlyData,
    },
  });

  return NextResponse.json(company);
}

// DELETE /api/companies/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;
  await prisma.company.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
