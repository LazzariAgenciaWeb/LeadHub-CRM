import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { cookies } from "next/headers";
import { prisma } from "./prisma";

export const IMPERSONATE_COOKIE = "x-impersonate";

/**
 * Like getServerSession, but respects impersonation:
 * if a SUPER_ADMIN has the impersonation cookie set, returns a session
 * that looks like a CLIENT for the target company.
 */
export async function getEffectiveSession() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const isSuperAdmin = (session.user as any)?.role === "SUPER_ADMIN";
  if (!isSuperAdmin) return session;

  const cookieStore = await cookies();
  const companyId = cookieStore.get(IMPERSONATE_COOKIE)?.value;
  if (!companyId) return session;

  // Verify company exists
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true },
  });
  if (!company) return session;

  return {
    ...session,
    user: {
      ...session.user,
      role: "CLIENT",
      companyId,
    },
    _impersonating: { companyId, companyName: company.name },
  } as typeof session & { _impersonating: { companyId: string; companyName: string } };
}

export function isImpersonating(session: any): boolean {
  return !!session?._impersonating;
}
