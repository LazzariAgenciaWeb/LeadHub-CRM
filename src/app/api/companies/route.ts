import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/companies?search= — Lista empresas (super admin vê todas, client vê a sua)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;
  const search = new URL(req.url).searchParams.get("search");

  const where: any = {};
  if (role !== "SUPER_ADMIN") {
    // CLIENT só vê a própria empresa
    if (!userCompanyId) return NextResponse.json([]);
    where.id = userCompanyId;
  }
  if (search) {
    where.name = { contains: search, mode: "insensitive" };
  }

  const companies = await prisma.company.findMany({
    where,
    orderBy: { name: "asc" },
    take: 20,
    select: { id: true, name: true, segment: true, status: true },
  });

  return NextResponse.json(companies);
}

// POST /api/companies — Criar nova empresa
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await request.json();
  const { name, segment, phone, email, website } = body;

  if (!name) {
    return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  }

  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  // Garantir slug único
  const existing = await prisma.company.findUnique({ where: { slug } });
  const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

  const company = await prisma.company.create({
    data: { name, slug: finalSlug, segment, phone, email, website },
  });

  return NextResponse.json(company, { status: 201 });
}
