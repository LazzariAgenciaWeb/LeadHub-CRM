import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { getCompanyPlan } from "./limits";

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
      moduleGamificacao: true,
      moduleProjetos: true,
      moduleCalendario: true,
      moduleProspeccao: true,
      moduleCampanhas: true,
      moduleLinks: true,
      moduleInstagram: true,
      moduleEspacoCliente: true,
    },
  });
  if (!company) return session;

  // Cofre + pipelines do CRM vêm de PlanFeatures (não de flags em Company),
  // igual o auth.ts faz no login real. Sem isso a sidebar impersonada esconde
  // os sub-itens do CRM mesmo quando o plano libera.
  let cofreEnabled = false;
  let pipelineProspeccao = false;
  let pipelineLeads = true;
  let pipelineOportunidades = false;
  try {
    const ctx = await getCompanyPlan(companyId);
    cofreEnabled = ctx.effectiveFeatures.cofreCredenciais;
    pipelineProspeccao = ctx.effectiveFeatures.crmPipelineProspeccao;
    pipelineLeads = ctx.effectiveFeatures.crmPipelineLeads;
    pipelineOportunidades = ctx.effectiveFeatures.crmPipelineOportunidades;
  } catch {
    // mantém defaults se a empresa não tiver subscription
  }

  // Impersonate as ADMIN of that company so the sidebar shows all enabled modules.
  // Using "ADMIN" (not SUPER_ADMIN) means SUPER_ADMIN-only API checks still block
  // privileged operations, but module-gated menus (WhatsApp, CRM, etc.) render correctly.
  return {
    ...session,
    user: {
      ...session.user,
      role: "ADMIN",
      companyId,
      // Reflect the company's actual enabled modules. Espelha o auth.ts real:
      // top-level + sub-pipelines do CRM. Faltando qualquer chave aqui faz a
      // sidebar esconder o item correspondente durante impersonação.
      modules: {
        ai:          company.moduleAI,
        crm:         company.moduleCrm,
        whatsapp:    company.moduleWhatsapp,
        tickets:     company.moduleTickets,
        clickup:     (company as any).moduleClickup ?? false,
        gamificacao: (company as any).moduleGamificacao ?? false,
        projetos:    (company as any).moduleProjetos ?? false,
        calendario:  (company as any).moduleCalendario ?? false,
        prospeccao:  (company as any).moduleProspeccao ?? false,
        campanhas:   (company as any).moduleCampanhas ?? false,
        links:       (company as any).moduleLinks ?? false,
        instagram:   (company as any).moduleInstagram ?? false,
        espacoCliente: (company as any).moduleEspacoCliente ?? false,
        cofre:       cofreEnabled,
        crmPipelineProspeccao:    pipelineProspeccao,
        crmPipelineLeads:         pipelineLeads,
        crmPipelineOportunidades: pipelineOportunidades,
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
        canViewCalendario:  true,
        canViewMarketing:   true,
        canViewCampanhas:   true,
        canViewProjetos:    true,
        canViewRanking:     true,
        canViewLinks:       true,
        canViewCofre:       true,
      },
    },
    _impersonating: { companyId, companyName: company.name },
  } as typeof session & { _impersonating: { companyId: string; companyName: string } };
}

export function isImpersonating(session: any): boolean {
  return !!session?._impersonating;
}
