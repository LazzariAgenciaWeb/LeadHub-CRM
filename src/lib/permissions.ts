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
}

export interface UserModules {
  ai: boolean;
  crm: boolean;
  whatsapp: boolean;
  tickets: boolean;
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
};

const ALL_MODULES: UserModules = { ai: true, crm: true, whatsapp: true, tickets: true };

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
  return (session?.user?.modules as UserModules) ?? { ai: false, crm: true, whatsapp: false, tickets: false };
}

/** Verifica se a sessão tem acesso a uma permissão específica do setor */
export function can(session: any, permission: keyof UserPermissions): boolean {
  return getPermissions(session)[permission];
}

/** Verifica se o módulo está habilitado para a empresa */
export function hasModule(session: any, module: keyof UserModules): boolean {
  return getModules(session)[module];
}
