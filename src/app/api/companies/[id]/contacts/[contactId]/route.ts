import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

// PATCH /api/companies/[id]/contacts/[contactId]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id, contactId } = await params;
  const body = await req.json();
  const { name, role, notes, hasAccess, userEmail, userName, resetPassword } = body;

  const contact = await prisma.companyContact.findFirst({
    where: { id: contactId, companyId: id },
    include: { user: true },
  });
  if (!contact) return NextResponse.json({ error: "Contato não encontrado" }, { status: 404 });

  let userId = contact.userId;
  let generatedPassword: string | null = null;

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
      ...(role !== undefined && { role }),
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
  if ((session?.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id, contactId } = await params;
  await prisma.companyContact.deleteMany({ where: { id: contactId, companyId: id } });
  return NextResponse.json({ ok: true });
}
