import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { IMPERSONATE_COOKIE } from "@/lib/effective-session";
import { recordAdminAction, extractIp } from "@/lib/admin-audit";

/**
 * Conta vinculada ("agir como") durante impersonação.
 *
 * GET   → usuários da empresa impersonada + qual está vinculado ao super admin
 * PATCH → { userId: string | null } vincula (ou desvincula) — máx. 1 por empresa.
 *
 * Só SUPER_ADMIN real, e só com impersonação ativa (cookie). O vínculo fica em
 * User.linkedSuperAdminId do usuário da empresa; effective-session usa isso pra
 * trocar a identidade da sessão.
 */
async function ctx(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "SUPER_ADMIN") return null;
  const companyId = req.cookies.get(IMPERSONATE_COOKIE)?.value;
  if (!companyId) return null;
  return { session, adminId: (session.user as any).id as string, companyId };
}

export async function GET(req: NextRequest) {
  const c = await ctx(req);
  if (!c) return NextResponse.json({ error: "Sem impersonação ativa" }, { status: 403 });

  const users = await prisma.user.findMany({
    where: { companyId: c.companyId, role: { not: "SUPER_ADMIN" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, role: true, linkedSuperAdminId: true },
  });
  return NextResponse.json({
    users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })),
    linkedUserId: users.find((u) => u.linkedSuperAdminId === c.adminId)?.id ?? null,
  });
}

export async function PATCH(req: NextRequest) {
  const c = await ctx(req);
  if (!c) return NextResponse.json({ error: "Sem impersonação ativa" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const userId: string | null = typeof body?.userId === "string" ? body.userId : null;

  if (userId) {
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true, role: true, name: true } });
    if (!target || target.companyId !== c.companyId || target.role === "SUPER_ADMIN") {
      return NextResponse.json({ error: "Usuário não pertence a esta empresa" }, { status: 400 });
    }
  }

  await prisma.$transaction([
    // 1 vínculo por empresa por super admin: limpa o anterior
    prisma.user.updateMany({
      where: { companyId: c.companyId, linkedSuperAdminId: c.adminId },
      data: { linkedSuperAdminId: null },
    }),
    ...(userId
      ? [prisma.user.update({ where: { id: userId }, data: { linkedSuperAdminId: c.adminId } })]
      : []),
  ]);

  await recordAdminAction({
    adminUserId:     c.adminId,
    adminUserName:   c.session.user?.name ?? null,
    adminUserEmail:  c.session.user?.email ?? null,
    action:          "IMPERSONATE_ACT_AS",
    targetCompanyId: c.companyId,
    targetUserId:    userId,
    ip:              extractIp(req),
    userAgent:       req.headers.get("user-agent"),
    metadata:        { linked: !!userId },
  });

  return NextResponse.json({ ok: true, linkedUserId: userId });
}
