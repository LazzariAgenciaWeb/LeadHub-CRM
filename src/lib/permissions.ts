/**
 * Helpers centralizados de permissão do LeadHub.
 *
 * Hierarquia:
 *   SUPER_ADMIN → tudo liberado, vê todos os tenants
 *   ADMIN       → admin da empresa: tudo liberado dentro da própria empresa
 *   CLIENT      → agente: restrito pelas permissões do seu Setor
 */

export interface UserPermissions {
  canManageUsers: boolean;
  canViewLeads: boolean;
  canCreateLeads: boolean;
  canViewTickets: boolean;
  canCreateTickets: boolean;
  canViewConfig: boolean;
  canUseAI: boolean;
  canViewInbox: boolean;
  canSendMessages: boolean;
  canViewCompanies: boolean;
  canCreateCompanies: boolean;
  // Permissões granulares por módulo — gate de Sidebar combinado com hasModule().
  // Setor admin (canManageUsers) escolhe quem vê o quê na empresa.
  canViewCalendario: boolean;
  canViewMarketing: boolean;
  canViewCampanhas: boolean;
  canViewProjetos: boolean;
  canViewRanking: boolean;
  canViewLinks: boolean;
  canViewCofre: boolean;
}

export interface UserModules {
  ai: boolean;
  crm: boolean;
  whatsapp: boolean;
  tickets: boolean;
  clickup: boolean;
  gamificacao: boolean;
  projetos: boolean;
  calendario: boolean;
  prospeccao: boolean;
  // Cofre é gateado por PlanFeatures.cofreCredenciais (não tem flag em Company).
  // Populado no session callback a partir do plano efetivo da empresa.
  cofre: boolean;
  // Sub-pipelines do CRM (granularidade por pipeline). Vêm de PlanFeatures
  // efetivas (plan + customFeatures), populadas no session callback do auth.
  crmPipelineProspeccao: boolean;
  crmPipelineLeads: boolean;
  crmPipelineOportunidades: boolean;
}

const ALL_PERMISSIONS: UserPermissions = {
  canManageUsers: true,
  canViewLeads: true,
  canCreateLeads: true,
  canViewTickets: true,
  canCreateTickets: true,
  canViewConfig: true,
  canUseAI: true,
  canViewInbox: true,
  canSendMessages: true,
  canViewCompanies: true,
  canCreateCompanies: true,
  canViewCalendario: true,
  canViewMarketing: true,
  canViewCampanhas: true,
  canViewProjetos: true,
  canViewRanking: true,
  canViewLinks: true,
  canViewCofre: true,
};

// Deny-by-default: CLIENT sem setor não enxerga nada até receber atribuição
// (fix C1). Antes do fix esse default liberava view de leads/tickets, criando
// janela de privilégio em novo atendente sem setor.
const DEFAULT_CLIENT_PERMISSIONS: UserPermissions = {
  canManageUsers: false,
  canViewLeads: false,
  canCreateLeads: false,
  canViewTickets: false,
  canCreateTickets: false,
  canViewConfig: false,
  canUseAI: false,
  canViewInbox: false,
  canSendMessages: false,
  canViewCompanies: false,
  canCreateCompanies: false,
  canViewCalendario: false,
  canViewMarketing: false,
  canViewCampanhas: false,
  canViewProjetos: false,
  canViewRanking: false,
  canViewLinks: false,
  canViewCofre: false,
};

const ALL_MODULES: UserModules = {
  ai: true, crm: true, whatsapp: true, tickets: true, clickup: true,
  gamificacao: true, projetos: true, calendario: true, prospeccao: true,
  cofre: true,
  crmPipelineProspeccao: true, crmPipelineLeads: true, crmPipelineOportunidades: true,
};

const DEFAULT_MODULES: UserModules = {
  ai: false, crm: true, whatsapp: false, tickets: false, clickup: false,
  gamificacao: false, projetos: false, calendario: false, prospeccao: false,
  cofre: false,
  crmPipelineProspeccao: false, crmPipelineLeads: true, crmPipelineOportunidades: false,
};

export function isSuperAdmin(session: any): boolean {
  return session?.user?.role === "SUPER_ADMIN";
}

export function isAdmin(session: any): boolean {
  const role = session?.user?.role;
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

export function getPermissions(session: any): UserPermissions {
  if (isAdmin(session)) return ALL_PERMISSIONS;
  return (session?.user?.permissions as UserPermissions) ?? DEFAULT_CLIENT_PERMISSIONS;
}

export function getModules(session: any): UserModules {
  if (isSuperAdmin(session)) return ALL_MODULES;
  return (session?.user?.modules as UserModules) ?? DEFAULT_MODULES;
}

/** Verifica se a sessão tem acesso a uma permissão específica do setor */
export function can(session: any, permission: keyof UserPermissions): boolean {
  return getPermissions(session)[permission];
}

/** Verifica se o módulo está habilitado para a empresa */
export function hasModule(session: any, module: keyof UserModules): boolean {
  return getModules(session)[module];
}
