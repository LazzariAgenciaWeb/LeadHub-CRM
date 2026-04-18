import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/companies?search= — Lista empresas
// SUPER_ADMIN: vê todas (sem parentCompanyId = empresas de nível 1)
// CLIENT: vê as sub-empresas cadastradas por ele (parentCompanyId = sua companyId)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;
  const search = new URL(req.url).searchParams.get("search");

  const where: any = {};

  if (role !== "SUPER_ADMIN") {
    // CLIENT: lista seus clientes (sub-empresas onde parentCompanyId = minha empresa)
    if (!userCompanyId) return NextResponse.json([]);
    where.parentCompanyId = userCompanyId;
  }

  if (search) {
    where.name = { contains: search, mode: "insensitive" };
  }

  const companies = await prisma.company.findMany({
    where,
    orderBy: { name: "asc" },
    take: 50,
    select: {
      id: true,
      name: true,
      segment: true,
      status: true,
      hasSystemAccess: true,
      moduleWhatsapp: true,
      moduleCrm: true,
      moduleTickets: true,
      parentCompanyId: true,
    },
  });

  return NextResponse.json(companies);
}

// POST /api/companies — Criar empresa
// SUPER_ADMIN: cria empresa de nível 1 (com opções de hasSystemAccess, módulos)
// CLIENT: cria sub-empresa vinculada a si (parentCompanyId automático)
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const body = await request.json();
  const {
    name,
    segment,
    phone,
    email,
    website,
    // SUPER_ADMIN only
    hasSystemAccess,
    moduleWhatsapp,
    moduleCrm,
    moduleTickets,
    parentCompanyId,
  } = body;

  if (!name) {
    return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  }

  // CLIENT só pode criar sub-empresa vinculada a si mesmo
  if (role !== "SUPER_ADMIN" && !userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const existing = await prisma.company.findUnique({ where: { slug } });
  const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

  const data: any = {
    name,
    slug: finalSlug,
    segment: segment || null,
    phone: phone || null,
    email: email || null,
    website: website || null,
  };

  if (role === "SUPER_ADMIN") {
    // SUPER_ADMIN pode definir tudo
    if (hasSystemAccess !== undefined) data.hasSystemAccess = hasSystemAccess;
    if (moduleWhatsapp !== undefined) data.moduleWhatsapp = moduleWhatsapp;
    if (moduleCrm !== undefined) data.moduleCrm = moduleCrm;
    if (moduleTickets !== undefined) data.moduleTickets = moduleTickets;
    if (parentCompanyId) data.parentCompanyId = parentCompanyId;
  } else {
    // CLIENT: sub-empresa sem acesso ao sistema, vinculada ao criador
    data.hasSystemAccess = false;
    data.parentCompanyId = userCompanyId;
  }

  const company = await prisma.company.create({ data });

  return NextResponse.json(company, { status: 201 });
}
