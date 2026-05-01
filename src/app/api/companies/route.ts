import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { isSuperAdmin, isAdmin, can } from "@/lib/permissions";

// GET /api/companies?search= — Lista empresas
// SUPER_ADMIN: vê todos os tenants (empresas de nível 1)
// ADMIN: vê sua empresa e sub-empresas (clientes)
// CLIENT com canViewCompanies: vê sub-empresas da sua empresa
//
// Usa getEffectiveSession para respeitar impersonação — quando o SUPER_ADMIN está
// impersonando uma empresa, esta lista volta as sub-empresas dela (clientes da AZZ),
// não os tenants nivel 1 do SUPER_ADMIN.
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;
  const search = new URL(req.url).searchParams.get("search");

  // CLIENT sem canViewCompanies → bloqueado
  if (role === "CLIENT" && !can(session, "canViewCompanies")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const where: any = {};

  if (isSuperAdmin(session)) {
    // SUPER_ADMIN: vê todos os tenants (sem parentCompanyId = nível 1)
    where.parentCompanyId = null;
  } else {
    // ADMIN e CLIENT: vê sub-empresas da sua empresa (clientes)
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

  // CLIENT sem canCreateCompanies → bloqueado
  if (role === "CLIENT" && !can(session, "canCreateCompanies")) {
    return NextResponse.json({ error: "Sem permissão para criar empresas" }, { status: 403 });
  }

  if (!isSuperAdmin(session) && !userCompanyId) {
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

  if (isSuperAdmin(session)) {
    // SUPER_ADMIN pode definir tudo
    if (hasSystemAccess !== undefined) data.hasSystemAccess = hasSystemAccess;
    if (moduleWhatsapp !== undefined) data.moduleWhatsapp = moduleWhatsapp;
    if (moduleCrm !== undefined) data.moduleCrm = moduleCrm;
    if (moduleTickets !== undefined) data.moduleTickets = moduleTickets;
    if (parentCompanyId) data.parentCompanyId = parentCompanyId;
  } else {
    // ADMIN e CLIENT: sub-empresa vinculada à sua empresa
    data.hasSystemAccess = false;
    data.parentCompanyId = userCompanyId;
  }

  const company = await prisma.company.create({ data });

  return NextResponse.json(company, { status: 201 });
}
