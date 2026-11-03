import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendAccessEmail } from "@/lib/email";
import { recordAdminAction, extractIp } from "@/lib/admin-audit";

/**
 * Administradores da plataforma (SUPER_ADMIN) — dono do LeadHub.
 *
 * GET  → lista os super admins + a conta interna vinculada de cada um.
 * POST → cria um super admin e, opcionalmente, a "conta interna" dele numa
 *        empresa (vínculo em User.linkedSuperAdminId). O vínculo é o que faz
 *        o assistente pessoal, os pontos e as mensagens saírem no nome da
 *        pessoa quando ela impersona aquela empresa — e é o que dá companyId
 *        à identidade dela (o resumo diário do WhatsApp só sai pra quem tem).
 *
 * Só SUPER_ADMIN REAL: /api/companies/[id]/users recusa criar SUPER_ADMIN de
 * propósito (dono da plataforma não é usuário de empresa-cliente), então esta
 * é a única porta. Fica fora da impersonação: é config da plataforma.
 */

/** Senha temporária de credencial de plataforma: crypto, não Math.random. */
function tempPassword(): string {
  return randomBytes(9).toString("base64url") + "A1!";
}

async function requireSuperAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false as const, response: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  if ((session.user as any)?.role !== "SUPER_ADMIN") {
    return { ok: false as const, response: NextResponse.json({ error: "Só o dono da plataforma pode gerenciar administradores" }, { status: 403 }) };
  }
  return { ok: true as const, session, adminId: (session.user as any).id as string };
}

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const admins = await prisma.user.findMany({
    where: { role: "SUPER_ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, createdAt: true },
  });
  const linked = await prisma.user.findMany({
    where: { linkedSuperAdminId: { in: admins.map((a) => a.id) } },
    select: {
      id: true, name: true, email: true, role: true, linkedSuperAdminId: true,
      company: { select: { id: true, name: true, tradeName: true } },
    },
  });

  return NextResponse.json({
    admins: admins.map((a) => ({
      ...a,
      isMe: a.id === auth.adminId,
      linked: linked
        .filter((u) => u.linkedSuperAdminId === a.id)
        .map((u) => ({
          id: u.id, name: u.name, email: u.email, role: u.role,
          companyId: u.company?.id ?? null,
          companyName: u.company?.tradeName || u.company?.name || null,
        })),
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const companyId = body?.companyId ? String(body.companyId) : "";
  const internalEmail = body?.internalEmail ? String(body.internalEmail).trim().toLowerCase() : "";
  const internalName = String(body?.internalName ?? "").trim() || name;
  const internalRole = body?.internalRole === "CLIENT" ? "CLIENT" : "ADMIN";

  if (!name) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  if (companyId && !internalEmail) return NextResponse.json({ error: "Informe o e-mail da conta interna (ou deixe a empresa em branco)" }, { status: 400 });
  if (internalEmail && !companyId) return NextResponse.json({ error: "Escolha a empresa da conta interna" }, { status: 400 });
  if (internalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(internalEmail)) {
    return NextResponse.json({ error: "E-mail da conta interna inválido" }, { status: 400 });
  }
  if (internalEmail && internalEmail === email) {
    return NextResponse.json({ error: "A conta interna precisa de um e-mail diferente do login de plataforma" }, { status: 400 });
  }

  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    return NextResponse.json({ error: "Já existe um usuário com esse e-mail" }, { status: 409 });
  }

  // Valida a conta interna ANTES de criar o super admin, pra não deixar login
  // de plataforma órfão quando o vínculo é impossível.
  let company: { id: string; name: string; tradeName: string | null } | null = null;
  let existingInternal: { id: string; name: string; companyId: string | null; role: string; linkedSuperAdminId: string | null } | null = null;
  if (companyId) {
    company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, tradeName: true } });
    if (!company) return NextResponse.json({ error: "Empresa não encontrada" }, { status: 400 });

    existingInternal = await prisma.user.findUnique({
      where: { email: internalEmail },
      select: { id: true, name: true, companyId: true, role: true, linkedSuperAdminId: true },
    });
    if (existingInternal) {
      if (existingInternal.role === "SUPER_ADMIN") {
        return NextResponse.json({ error: "Esse e-mail já é de um administrador da plataforma" }, { status: 409 });
      }
      if (existingInternal.companyId !== companyId) {
        return NextResponse.json({ error: "Esse e-mail já é de um usuário de outra empresa" }, { status: 409 });
      }
      if (existingInternal.linkedSuperAdminId) {
        return NextResponse.json({ error: "Essa conta interna já está vinculada a outro administrador" }, { status: 409 });
      }
    }
  }

  const adminPassword = tempPassword();
  const superAdmin = await prisma.user.create({
    data: { name, email, password: await bcrypt.hash(adminPassword, 12), role: "SUPER_ADMIN" },
    select: { id: true, name: true, email: true, role: true },
  });

  let internal: { id: string; name: string; email: string; role: string; password: string | null; created: boolean } | null = null;
  if (company) {
    if (existingInternal) {
      await prisma.user.update({ where: { id: existingInternal.id }, data: { linkedSuperAdminId: superAdmin.id } });
      internal = { id: existingInternal.id, name: existingInternal.name, email: internalEmail, role: existingInternal.role, password: null, created: false };
    } else {
      const internalPassword = tempPassword();
      const created = await prisma.user.create({
        data: {
          name: internalName, email: internalEmail, password: await bcrypt.hash(internalPassword, 12),
          role: internalRole as any, companyId: company.id, linkedSuperAdminId: superAdmin.id,
        },
        select: { id: true, name: true, email: true, role: true },
      });
      internal = { ...created, password: internalPassword, created: true };
      void sendAccessEmail({ to: created.email, name: created.name, tempPassword: internalPassword }).catch((err) => {
        console.warn("[SuperAdmins] Falha ao enviar acesso da conta interna:", err);
      });
    }
  }

  void sendAccessEmail({ to: superAdmin.email, name: superAdmin.name, tempPassword: adminPassword }).catch((err) => {
    console.warn("[SuperAdmins] Falha ao enviar acesso do super admin:", err);
  });

  const ip = extractIp(req);
  const ua = req.headers.get("user-agent");
  await recordAdminAction({
    adminUserId: auth.adminId,
    adminUserName: auth.session.user?.name ?? null,
    adminUserEmail: auth.session.user?.email ?? null,
    action: "SUPER_ADMIN_CREATE",
    targetUserId: superAdmin.id,
    ip, userAgent: ua,
    metadata: { email: superAdmin.email },
  });
  if (internal && company) {
    await recordAdminAction({
      adminUserId: auth.adminId,
      adminUserName: auth.session.user?.name ?? null,
      adminUserEmail: auth.session.user?.email ?? null,
      action: "SUPER_ADMIN_LINK",
      targetCompanyId: company.id,
      targetUserId: internal.id,
      ip, userAgent: ua,
      metadata: { superAdminId: superAdmin.id, created: internal.created, role: internal.role },
    });
  }

  return NextResponse.json({
    superAdmin: { ...superAdmin, tempPassword: adminPassword },
    internal: internal
      ? { ...internal, companyId: company!.id, companyName: company!.tradeName || company!.name }
      : null,
  });
}
