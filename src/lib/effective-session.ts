import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { getCompanyPlan } from "./limits";

export const IMPERSONATE_COOKIE = "x-impersonate";
// 30 dias — sair da impersonação é ação explícita (banner), não expiração.
export const IMPERSONATE_MAX_AGE = 60 * 60 * 24 * 30;

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
      moduleVideos: true,
    },
  });
  if (!company) return session;

  // Conta vinculada: se o super admin disse "nesta empresa eu sou o usuário X",
  // a sessão impersonada assume a identidade de X (id/nome/e-mail). Assim o
  // que ele faz dentro do cliente (mensagem, atribuição, pontos) sai no nome
  // certo, e não como "Diego Lazzari (super admin)". Sem vínculo → observa
  // com a identidade real do super admin, como antes.
  const realUserId = (session.user as any)?.id as string | undefined;
  const linked = realUserId
    ? await prisma.user.findFirst({
        where: { companyId, linkedSuperAdminId: realUserId, role: { not: "SUPER_ADMIN" } },
        select: { id: true, name: true, email: true },
      })
    : null;

  // Cofre + pipelines do CRM vêm de PlanFeatures (não de flags em Company),
  // igual o auth.ts faz no login real. Sem isso a sidebar impersonada esconde
  // os sub-itens do CRM mesmo quando o plano libera.
  let cofreEnabled = false;
  let pipelineProspeccao = false;
  let pipelineLeads = true;
  let pipelineOportunidades = false;
  let caixaEmailFeat = false;
  let assistentePessoalFeat = false;
  try {
    const ctx = await getCompanyPlan(companyId);
    cofreEnabled = ctx.effectiveFeatures.cofreCredenciais;
    assistentePessoalFeat = ctx.effectiveFeatures.assistentePessoal;
    pipelineProspeccao = ctx.effectiveFeatures.crmPipelineProspeccao;
    pipelineLeads = ctx.effectiveFeatures.crmPipelineLeads;
    pipelineOportunidades = ctx.effectiveFeatures.crmPipelineOportunidades;
    caixaEmailFeat = ctx.effectiveFeatures.caixaEmail;
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
      ...(linked ? { id: linked.id, name: linked.name, email: linked.email } : {}),
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
        emailInbox:  ((company as any).moduleEmailInbox ?? false) || caixaEmailFeat,
        links:       (company as any).moduleLinks ?? false,
        instagram:   (company as any).moduleInstagram ?? false,
        espacoCliente: (company as any).moduleEspacoCliente ?? false,
        videos:      (company as any).moduleVideos ?? false,
        cofre:       cofreEnabled,
        assistentePessoal: assistentePessoalFeat,
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
        canViewFinanceiro:  true,
      },
    },
    _impersonating: {
      companyId,
      companyName: company.name,
      realUserId: realUserId ?? null,
      actingAs: linked ? { userId: linked.id, name: linked.name } : null,
    },
  } as typeof session & { _impersonating: ImpersonationInfo };
}

export type ImpersonationInfo = {
  companyId: string;
  companyName: string;
  /** id real do SUPER_ADMIN logado (session.user.id pode ser o da conta vinculada) */
  realUserId: string | null;
  /** conta vinculada em uso — null = observando com a identidade do super admin */
  actingAs: { userId: string; name: string } | null;
};

export function isImpersonating(session: any): boolean {
  return !!session?._impersonating;
}

/**
 * Sessão da IDENTIDADE em vigor — pra recursos pessoais (assistente, Meu
 * Perfil, assinatura do WhatsApp):
 * - impersonando COM conta vinculada → sessão efetiva (id/nome do vinculado);
 * - impersonando SEM vínculo → sessão real (o super admin continua sendo ele);
 * - sem impersonação → sessão normal.
 */
export async function getActingSession() {
  const eff = await getEffectiveSession();
  if (!eff) return null;
  const imp = (eff as any)._impersonating as ImpersonationInfo | undefined;
  if (!imp) return eff;
  if (imp.actingAs) return eff;
  return getServerSession(authOptions);
}
