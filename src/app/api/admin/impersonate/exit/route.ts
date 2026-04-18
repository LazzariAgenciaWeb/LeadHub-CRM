import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { IMPERSONATE_COOKIE } from "@/lib/effective-session";

// GET /api/admin/impersonate/exit — encerra impersonação
// Accepts optional ?returnTo=/path query param to redirect somewhere specific
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  const { searchParams } = new URL(req.url);
  const returnTo = searchParams.get("returnTo");

  const companyId = req.cookies.get(IMPERSONATE_COOKIE)?.value;
  const returnUrl = returnTo ?? (companyId ? `/empresas/${companyId}` : "/empresas");

  const baseUrl = process.env.NEXTAUTH_URL ?? `https://${req.headers.get("host")}`;
  const res = NextResponse.redirect(new URL(returnUrl, baseUrl));
  res.cookies.delete(IMPERSONATE_COOKIE);
  return res;
}
