import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { sendAccessEmail } from "@/lib/email";

/** SUPER_ADMIN sempre; ADMIN/CLIENT só na própria empresa ou sub-empresa. */
async function canAccessCompany(session: any, targetCompanyId: string): Promise<boolean> {
  const role = (session?.user as any)?.role as string;
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

// POST /api/companies/[id]/users — cria um usuário do sistema (login) direto,
// sem exigir Contato WhatsApp. Telefone é opcional (se vier, vincula um contato).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any)?.role as string;
  // Criar login é ação de gestor.
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão para criar usuários" }, { status: 403 });
  }

  const { id } = await params;
  if (!(await canAccessCompany(session, id))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const userRole = String(body.role ?? "CLIENT");
  const phoneRaw = body.phone ? String(body.phone).trim() : "";

  if (!name) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Email inválido" }, { status: 400 });
  }
  // Não cria SUPER_ADMIN por aqui (Lazzari não vira usuário de empresa-cliente).
  if (!["ADMIN", "CLIENT"].includes(userRole)) {
    return NextResponse.json({ error: "Papel inválido" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return NextResponse.json({ error: "Já existe um usuário com esse email" }, { status: 409 });
  }

  const tempPassword = Math.random().toString(36).slice(-8) + "A1!";
  const hash = await bcrypt.hash(tempPassword, 10);
  const user = await prisma.user.create({
    data: { name, email, password: hash, role: userRole as any, companyId: id },
    select: { id: true, name: true, email: true, role: true },
  });

  // Telefone opcional → também cria/vincula um Contato WhatsApp com acesso.
  if (phoneRaw) {
    const phone = phoneRaw.replace(/\D/g, "") || phoneRaw;
    await prisma.companyContact.upsert({
      where: { companyId_phone: { companyId: id, phone } },
      create: { companyId: id, phone, name, role: "CONTACT", hasAccess: true, userId: user.id },
      update: { hasAccess: true, userId: user.id, name },
    });
  }

  // Email de acesso com credenciais (+ vídeo de introdução, se configurado).
  // Se SMTP falhar, o admin ainda recebe a senha no response pra repassar.
  void sendAccessEmail({ to: email, name, tempPassword }).catch((err) => {
    console.warn("[Users] Falha ao enviar email de acesso:", err);
  });

  return NextResponse.json({ user, tempPassword });
}
