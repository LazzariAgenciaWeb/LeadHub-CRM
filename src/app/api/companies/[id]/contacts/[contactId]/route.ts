import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { can } from "@/lib/permissions";
import { sendMail } from "@/lib/email";

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
  const { name, role: contactRole, notes, hasAccess, userEmail, userName, resetPassword, userRole } = body;

  const contact = await prisma.companyContact.findFirst({
    where: { id: contactId, companyId: id },
    include: { user: true },
  });
  if (!contact) return NextResponse.json({ error: "Contato não encontrado" }, { status: 404 });

  let userId = contact.userId;
  let generatedPassword: string | null = null;

  // Gestão de acesso (criar user, conceder/revogar, resetar senha):
  // SUPER_ADMIN sempre pode; ADMIN só pode gerir contatos da própria empresa.
  // canAccessCompany já garantiu acesso à empresa-alvo acima.
  if ((hasAccess !== undefined || userEmail || resetPassword) && role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão para gerenciar acesso" }, { status: 403 });
  }

  // fix A2 — antes era possível marcar hasAccess=true sem fornecer userEmail
  // e o contato ficava como "tem acesso ao portal" mas sem User vinculado.
  // Cliente pensava que liberou login e ninguém conseguia entrar.
  // Agora exige email quando ativa acesso e ainda não há User vinculado.
  if (hasAccess === true && !contact.userId && !userEmail) {
    return NextResponse.json(
      { error: "userEmail é obrigatório para liberar acesso ao portal" },
      { status: 400 },
    );
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

      // Email de boas-vindas com a senha temporária — se SMTP falhar,
      // admin ainda recebe a senha no response pra repassar manualmente.
      const portalUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXTAUTH_URL ?? "";
      const loginLink = portalUrl ? `${portalUrl.replace(/\/$/, "")}/login` : "/login";
      const userDisplay = userName ?? contact.name ?? userEmail.split("@")[0];
      void sendMail({
        to: userEmail,
        subject: "Seu acesso ao LeadHub está pronto",
        html: `
          <p>Olá ${userDisplay},</p>
          <p>Seu acesso ao portal foi liberado. Use as credenciais abaixo para entrar:</p>
          <ul>
            <li><strong>Email:</strong> ${userEmail}</li>
            <li><strong>Senha temporária:</strong> <code>${tempPassword}</code></li>
          </ul>
          <p><a href="${loginLink}">Entrar no LeadHub</a></p>
          <p>Após o primeiro login, troque a senha em Configurações → Minha Empresa.</p>
        `,
        text: `Olá ${userDisplay}, seu acesso ao LeadHub está pronto.\nEmail: ${userEmail}\nSenha temporária: ${tempPassword}\nLogin: ${loginLink}`,
      }).catch((err) => {
        console.warn("[Contacts] Falha ao enviar email de boas-vindas:", err);
      });
    }
  }

  // Redefinir senha de usuário existente
  if (resetPassword && contact.userId) {
    const tempPassword = Math.random().toString(36).slice(-8) + "A1!";
    const hash = await bcrypt.hash(tempPassword, 10);
    await prisma.user.update({ where: { id: contact.userId }, data: { password: hash } });
    generatedPassword = tempPassword;
  }

  // Promover/rebaixar usuário entre ADMIN e CLIENT (atendente). SUPER_ADMIN
  // só pode ser concedido por outro SUPER_ADMIN — ADMIN comum não escala.
  if (userRole && contact.userId) {
    const allowed: string[] = role === "SUPER_ADMIN" ? ["SUPER_ADMIN", "ADMIN", "CLIENT"] : ["ADMIN", "CLIENT"];
    if (!allowed.includes(userRole)) {
      return NextResponse.json({ error: "Você não pode atribuir esse papel" }, { status: 403 });
    }
    await prisma.user.update({ where: { id: contact.userId }, data: { role: userRole } });
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
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
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
