import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { IMPERSONATE_COOKIE } from "@/lib/effective-session";
import { recordAdminAction, extractIp } from "@/lib/admin-audit";
import { prisma } from "@/lib/prisma";

// GET /api/admin/impersonate/[companyId] — inicia impersonação
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { companyId } = await params;

  // fix A1 — auditoria de impersonation. Cliente precisa saber quando alguém
  // da Lazzari logou como ele (B2B/LGPD).
  const targetCompany = await prisma.company.findUnique({
    where:  { id: companyId },
    select: { name: true },
  });
  await recordAdminAction({
    adminUserId:     (session.user as any).id,
    adminUserName:   session.user?.name ?? null,
    adminUserEmail:  session.user?.email ?? null,
    action:          "IMPERSONATE_START",
    targetCompanyId: companyId,
    ip:              extractIp(req),
    userAgent:       req.headers.get("user-agent"),
    metadata:        { targetCompanyName: targetCompany?.name ?? null },
  });

  const baseUrl = process.env.NEXTAUTH_URL ?? `https://${req.headers.get("host")}`;
  const res = NextResponse.redirect(new URL("/dashboard", baseUrl));
  res.cookies.set(IMPERSONATE_COOKIE, companyId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60, // 1 hora
  });
  return res;
}
