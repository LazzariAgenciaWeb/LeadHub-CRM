/**
 * user-permissions.ts
 *
 * Helper central de permissões.
 * ADMIN (role CLIENT com acesso total) ou SUPER_ADMIN → sem restrições.
 * Usuários comuns → permissões herdadas da UNIÃO dos setores a que pertencem.
 *
 * IMPORTANTE: CLIENT sem nenhum setor atribuído fica SEM permissões (deny by default).
 * Antes do fix C1, esse caso virava admin da empresa — risco crítico de privilege
 * escalation enquanto novo atendente ficava sem setor.
 *
 * Uso:
 *   const perms = await getUserPermissions(session);
 *   if (!perms.canViewLeads) return 403;
 *   where.instanceId = { in: perms.instanceIds };   // filtra WhatsApp
 *   if (perms.setorIds) where.setorId = { in: perms.setorIds }; // filtra tickets
 */

import { prisma } from "./prisma";

export interface UserPermissions {
  isAdmin: boolean;          // SUPER_ADMIN ou ADMIN explícito
  companyId: string;
  setorIds: string[] | null; // null = sem restrição (admin); array = setores do usuário; [] = sem setor
  instanceIds: string[] | null; // null = sem restrição; array = instâncias permitidas
  emailAccountIds: string[] | null; // null = todas as caixas de email; array = só as vinculadas aos setores
  noSetor: boolean;          // true → CLIENT sem nenhum setor (todas flags false)
  canManageUsers: boolean;
  canViewLeads: boolean;
  canCreateLeads: boolean;
  canViewTickets: boolean;
  canCreateTickets: boolean;
  canViewConfig: boolean;
}

export async function getUserPermissions(session: any): Promise<UserPermissions | null> {
  const role      = session?.user?.role as string | undefined;
  const companyId = session?.user?.companyId as string | undefined;
  const userId    = session?.user?.id as string | undefined;

  if (!userId) return null;

  // SUPER_ADMIN → dono da plataforma, sem companyId próprio.
  // ADMIN → administrador da empresa-cliente, sempre tem companyId.
  // Ambos passam sem restrição de setor.
  if (role === "SUPER_ADMIN" || role === "ADMIN") {
    return {
      isAdmin: true,
      companyId: companyId ?? "",
      setorIds: null,
      instanceIds: null,
      emailAccountIds: null,
      noSetor: false,
      canManageUsers: true,
      canViewLeads: true,
      canCreateLeads: true,
      canViewTickets: true,
      canCreateTickets: true,
      canViewConfig: true,
    };
  }

  // CLIENT precisa de companyId pra carregar setores.
  if (!companyId) return null;

  // Busca os setores do usuário
  const setorUsers = await prisma.setorUser.findMany({
    where: { userId },
    include: {
      setor: {
        include: {
          instances: { select: { instanceId: true } },
          emailAccounts: { select: { accountId: true } },
        },
      },
    },
  });

  // CLIENT sem setor → DENY BY DEFAULT.
  // Antes do fix C1 isso virava admin da empresa; um novo atendente sem setor
  // tinha acesso total (incluindo cofre, billing, exclusão de leads).
  // Agora o usuário não vê nada até receber pelo menos um setor.
  if (setorUsers.length === 0) {
    return {
      isAdmin: false,
      companyId,
      setorIds: [],
      instanceIds: [],
      emailAccountIds: [],
      noSetor: true,
      canManageUsers: false,
      canViewLeads: false,
      canCreateLeads: false,
      canViewTickets: false,
      canCreateTickets: false,
      canViewConfig: false,
    };
  }

  // União de permissões de todos os setores
  const setorIds    = setorUsers.map((su) => su.setorId);
  const instanceIds = [
    ...new Set(setorUsers.flatMap((su) => su.setor.instances.map((i) => i.instanceId))),
  ];
  // Caixas de email: união dos vínculos dos setores. NENHUM vínculo em nenhum
  // setor → null (vê todas — compat com setores criados antes da feature).
  const emailAccountIds = [
    ...new Set(setorUsers.flatMap((su) => (su.setor as any).emailAccounts?.map((e: any) => e.accountId) ?? [])),
  ];

  const perms = {
    canManageUsers:   setorUsers.some((su) => su.setor.canManageUsers),
    canViewLeads:     setorUsers.some((su) => su.setor.canViewLeads),
    canCreateLeads:   setorUsers.some((su) => su.setor.canCreateLeads),
    canViewTickets:   setorUsers.some((su) => su.setor.canViewTickets),
    canCreateTickets: setorUsers.some((su) => su.setor.canCreateTickets),
    canViewConfig:    setorUsers.some((su) => su.setor.canViewConfig),
  };

  return {
    isAdmin: false,
    companyId,
    setorIds,
    instanceIds: instanceIds.length > 0 ? instanceIds : [],
    emailAccountIds: emailAccountIds.length > 0 ? emailAccountIds : null,
    noSetor: false,
    ...perms,
  };
}
