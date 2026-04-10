import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { IMPERSONATE_COOKIE } from "@/lib/effective-session";

// GET /api/admin/impersonate/exit — encerra impersonação
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  const companyId = req.cookies.get(IMPERSONATE_COOKIE)?.value;
  const returnUrl = companyId ? `/empresas/${companyId}` : "/empresas";

  const res = NextResponse.redirect(new URL(returnUrl, req.url));
  res.cookies.delete(IMPERSONATE_COOKIE);
  return res;
}
