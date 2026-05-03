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
      noSetor: false,
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
    noSetor: false,
    ...perms,
  };
}
