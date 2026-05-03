import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { IMPERSONATE_COOKIE } from "@/lib/effective-session";
import { recordAdminAction, extractIp } from "@/lib/admin-audit";

// GET /api/admin/impersonate/exit — encerra impersonação
// Accepts optional ?returnTo=/path query param to redirect somewhere specific
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // fix A1 — registra fim da sessão de impersonation pra fechar o ciclo
  // (admin precisa conseguir provar "entrei e saí entre X e Y").
  const cookieValue = req.cookies.get(IMPERSONATE_COOKIE)?.value;
  if (cookieValue) {
    await recordAdminAction({
      adminUserId:     (session.user as any).id,
      adminUserName:   session.user?.name ?? null,
      adminUserEmail:  session.user?.email ?? null,
      action:          "IMPERSONATE_END",
      targetCompanyId: cookieValue,
      ip:              extractIp(req),
      userAgent:       req.headers.get("user-agent"),
    });
  }

  const { searchParams } = new URL(req.url);
  const returnTo = searchParams.get("returnTo");

  // Default: vai pro /dashboard do SuperAdmin (não pra /empresas/{id} que mostrava a
  // empresa que estava sendo impersonada, dando a sensação de "ainda está logado nela")
  const returnUrl = returnTo ?? "/dashboard";

  const baseUrl = process.env.NEXTAUTH_URL ?? `https://${req.headers.get("host")}`;
  const res = NextResponse.redirect(new URL(returnUrl, baseUrl));

  // Robust delete: setar com maxAge=0 + mesmo path/sameSite/httpOnly do set original.
  // O .delete() sozinho nem sempre limpa cookies HttpOnly quando o path foi especificado
  // explicitamente na criação — depende da versão do Next/runtime.
  res.cookies.set(IMPERSONATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
  // Belt + suspenders
  res.cookies.delete({ name: IMPERSONATE_COOKIE, path: "/" });
  return res;
}
