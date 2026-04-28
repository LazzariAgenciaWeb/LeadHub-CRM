import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";

/** Verifica se o usuário tem acesso à empresa alvo (companyId = [id]).
 *  SUPER_ADMIN → sempre.
 *  ADMIN / CLIENT → a empresa deve ser sub-empresa da empresa do usuário
 *                   OU ser a própria empresa do usuário.
 */
async function canAccessCompany(session: any, targetCompanyId: string): Promise<boolean> {
  const role        = (session?.user as any)?.role as string;
  const userCompany = (session?.user as any)?.companyId as string | undefined;

  if (role === "SUPER_ADMIN") return true;
  if (!userCompany) return false;
  if (userCompany === targetCompanyId) return true;

  // Verifica se targetCompany é sub-empresa do usuário
  const sub = await prisma.company.findFirst({
    where: { id: targetCompanyId, parentCompanyId: userCompany },
    select: { id: true },
  });
  return !!sub;
}

// GET /api/companies/[id]/contacts
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;

  if (!(await canAccessCompany(session, id))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const contacts = await prisma.companyContact.findMany({
    where: { companyId: id },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  return NextResponse.json(contacts);
}

// POST /api/companies/[id]/contacts
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session?.user as any)?.role as string;

  // CLIENT precisa de canCreateCompanies para vincular contatos
  if (role === "CLIENT" && !can(session, "canCreateCompanies")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { id } = await params;

  if (!(await canAccessCompany(session, id))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const { name, phone, isGroup, role, notes } = await req.json();

  if (!phone?.trim()) {
    return NextResponse.json({ error: "Telefone/ID é obrigatório" }, { status: 400 });
  }

  // Normalize: remove non-digits for regular phones
  const normalizedPhone = isGroup
    ? phone.trim()
    : phone.trim().replace(/\D/g, "");

  const existing = await prisma.companyContact.findFirst({
    where: { companyId: id, phone: normalizedPhone },
  });
  if (existing) {
    return NextResponse.json({ error: "Este contato já está cadastrado" }, { status: 409 });
  }

  const contact = await prisma.companyContact.create({
    data: {
      companyId: id,
      phone: normalizedPhone,
      name: name?.trim() || null,
      isGroup: isGroup ?? false,
      role: role ?? "CONTACT",
      notes: notes?.trim() || null,
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  return NextResponse.json(contact);
}
