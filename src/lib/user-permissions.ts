/**
 * user-permissions.ts
 *
 * Helper central de permissões.
 * ADMIN (role CLIENT com acesso total) ou SUPER_ADMIN → sem restrições.
 * Usuários comuns → permissões herdadas da UNIÃO dos setores a que pertencem.
 *
 * Uso:
 *   const perms = await getUserPermissions(session);
 *   if (!perms.canViewLeads) return 403;
 *   where.instanceId = { in: perms.instanceIds };   // filtra WhatsApp
 *   if (perms.setorIds) where.setorId = { in: perms.setorIds }; // filtra tickets
 */

import { prisma } from "./prisma";

export interface UserPermissions {
  isAdmin: boolean;          // SUPER_ADMIN ou usuário sem restrição de setor
  companyId: string;
  setorIds: string[] | null; // null = sem restrição (admin); array = setores do usuário
  instanceIds: string[] | null; // null = sem restrição; array = instâncias permitidas
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

  if (!companyId || !userId) return null;

  // SUPER_ADMIN e ADMIN → sem nenhuma restrição de setor
  // ADMIN é o administrador da empresa: gerencia usuários, setores e configurações.
  // Mesmo que esteja em algum setor, deve ter acesso irrestrito.
  if (role === "SUPER_ADMIN" || role === "ADMIN") {
    return {
      isAdmin: true,
      companyId,
      setorIds: null,
      instanceIds: null,
      canManageUsers: true,
      canViewLeads: true,
      canCreateLeads: true,
      canViewTickets: true,
      canCreateTickets: true,
      canViewConfig: true,
    };
  }

  // Busca os setores do usuário
  const setorUsers = await prisma.setorUser.findMany({
    where: { userId },
    include: {
      setor: {
        include: {
          instances: { select: { instanceId: true } },
        },
      },
    },
  });

  // Usuário sem nenhum setor → trata como admin da empresa (acesso total)
  if (setorUsers.length === 0) {
    return {
      isAdmin: true,
      companyId,
      setorIds: null,
      instanceIds: null,
      canManageUsers: true,
      canViewLeads: true,
      canCreateLeads: true,
      canViewTickets: true,
      canCreateTickets: true,
      canViewConfig: true,
    };
  }

  // União de permissões de todos os setores
  const setorIds    = setorUsers.map((su) => su.setorId);
  const instanceIds = [
    ...new Set(setorUsers.flatMap((su) => su.setor.instances.map((i) => i.instanceId))),
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
    ...perms,
  };
}
