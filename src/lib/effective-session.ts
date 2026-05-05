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

  // Verify company exists and fetch its module flags
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      moduleWhatsapp: true,
      moduleCrm: true,
      moduleTickets: true,
      moduleAI: true,
      moduleClickup: true,
    },
  });
  if (!company) return session;

  // Impersonate as ADMIN of that company so the sidebar shows all enabled modules.
  // Using "ADMIN" (not SUPER_ADMIN) means SUPER_ADMIN-only API checks still block
  // privileged operations, but module-gated menus (WhatsApp, CRM, etc.) render correctly.
  return {
    ...session,
    user: {
      ...session.user,
      role: "ADMIN",
      companyId,
      // Reflect the company's actual enabled modules
      modules: {
        whatsapp: company.moduleWhatsapp,
        crm:      company.moduleCrm,
        tickets:  company.moduleTickets,
        ai:       company.moduleAI,
        clickup:  (company as any).moduleClickup ?? false,
      },
      // Admin has all permissions
      permissions: {
        canManageUsers:     true,
        canViewLeads:       true,
        canCreateLeads:     true,
        canViewTickets:     true,
        canCreateTickets:   true,
        canViewConfig:      true,
        canUseAI:           true,
        canViewInbox:       true,
        canSendMessages:    true,
        canViewCompanies:   true,
        canCreateCompanies: true,
      },
    },
    _impersonating: { companyId, companyName: company.name },
  } as typeof session & { _impersonating: { companyId: string; companyName: string } };
}

export function isImpersonating(session: any): boolean {
  return !!session?._impersonating;
}
