import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { can } from "@/lib/permissions";

/** Verifica acesso à empresa alvo (sub-empresa ou própria). */
async function canAccessCompany(session: any, targetCompanyId: string): Promise<boolean> {
  const role        = (session?.user as any)?.role as string;
  const userCompany = (session?.user as any)?.companyId as string | undefined;
  if (role === "SUPER_ADMIN") return true;
  if (!userCompany) return false;
  if (userCompany === targetCompanyId) return true;
  const sub = await prisma.company.findFirst({
    where: { id: targetCompanyId, parentCompanyId: userCompany },
    select: { id: true },
  });
  return !!sub;
}

// PATCH /api/companies/[id]/contacts/[contactId]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session?.user as any)?.role as string;

  // CLIENT precisa de canCreateCompanies para editar contatos
  if (role === "CLIENT" && !can(session, "canCreateCompanies")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { id, contactId } = await params;

  if (!(await canAccessCompany(session, id))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const { name, role: contactRole, notes, hasAccess, userEmail, userName, resetPassword } = body;

  const contact = await prisma.companyContact.findFirst({
    where: { id: contactId, companyId: id },
    include: { user: true },
  });
  if (!contact) return NextResponse.json({ error: "Contato não encontrado" }, { status: 404 });

  let userId = contact.userId;
  let generatedPassword: string | null = null;

  // Criação de usuário e gestão de acesso: apenas SUPER_ADMIN
  if ((hasAccess !== undefined || userEmail || resetPassword) && role !== "SUPER_ADMIN") { // role = user role
    return NextResponse.json({ error: "Apenas super admin pode gerenciar acesso ao sistema" }, { status: 403 });
  }

  // Quando ativa acesso + fornece email → cria/vincula User
  if (hasAccess && userEmail && !contact.userId) {
    const existingUser = await prisma.user.findUnique({ where: { email: userEmail } });
    if (existingUser) {
      userId = existingUser.id;
    } else {
      const tempPassword = Math.random().toString(36).slice(-8) + "A1!";
      const hash = await bcrypt.hash(tempPassword, 10);
      const newUser = await prisma.user.create({
        data: {
          name: userName ?? contact.name ?? userEmail.split("@")[0],
          email: userEmail,
          password: hash,
          role: "CLIENT",
          companyId: id,
        },
      });
      userId = newUser.id;
      generatedPassword = tempPassword; // retorna só uma vez
    }
  }

  // Redefinir senha de usuário existente
  if (resetPassword && contact.userId) {
    const tempPassword = Math.random().toString(36).slice(-8) + "A1!";
    const hash = await bcrypt.hash(tempPassword, 10);
    await prisma.user.update({ where: { id: contact.userId }, data: { password: hash } });
    generatedPassword = tempPassword;
  }

  // Quando desativa acesso → desvincula User (mas não deleta)
  if (hasAccess === false) {
    userId = null;
  }

  const updated = await prisma.companyContact.update({
    where: { id: contactId },
    data: {
      ...(name !== undefined && { name: name?.trim() || null }),
      ...(contactRole !== undefined && { role: contactRole }),
      ...(notes !== undefined && { notes: notes?.trim() || null }),
      ...(hasAccess !== undefined && { hasAccess }),
      ...(userId !== contact.userId && { userId }),
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  return NextResponse.json({ ...updated, tempPassword: generatedPassword });
}

// DELETE /api/companies/[id]/contacts/[contactId]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const deleteRole = (session?.user as any)?.role as string;

  if (deleteRole === "CLIENT" && !can(session, "canCreateCompanies")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { id, contactId } = await params;

  if (!(await canAccessCompany(session, id))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  await prisma.companyContact.deleteMany({ where: { id: contactId, companyId: id } });
  return NextResponse.json({ ok: true });
}
