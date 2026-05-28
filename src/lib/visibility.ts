import { prisma } from "@/lib/prisma";

// Controle de acesso "aberto/restrito" pra chamados (Ticket) e projetos
// (SetorClickupList).
//
//   OPEN       → toda a empresa vê (comportamento histórico).
//   RESTRICTED → só quem é do setor do item + pessoas extras (accessUsers) +
//                envolvidos (assignee/criador no chamado; membros no projeto).
//
// ADMIN da empresa e SUPER_ADMIN SEMPRE veem tudo (privileged) — a restrição
// vale só pra atendentes/usuários comuns. O isolamento por empresa (companyId)
// continua valendo por cima disso, em cada rota.

export type Viewer = {
  userId:       string | undefined;
  role:         string | undefined;
  companyId:    string | undefined;
  isPrivileged: boolean;     // ADMIN ou SUPER_ADMIN → ignora restrição
  setorIds:     string[];    // setores aos quais o usuário pertence
};

/** Monta o contexto de visibilidade do usuário da sessão (efetiva). */
export async function getViewer(session: any): Promise<Viewer> {
  const role      = (session?.user as any)?.role as string | undefined;
  const userId    = (session?.user as any)?.id as string | undefined;
  const companyId = (session?.user as any)?.companyId as string | undefined;
  const isPrivileged = role === "SUPER_ADMIN" || role === "ADMIN";

  let setorIds: string[] = [];
  if (!isPrivileged && userId) {
    const rows = await prisma.setorUser.findMany({
      where:  { userId },
      select: { setorId: true },
    });
    setorIds = rows.map((r) => r.setorId);
  }
  return { userId, role, companyId, isPrivileged, setorIds };
}

const NONE = "__none__"; // sentinela pra nunca casar quando não há id

/**
 * Fragmento Prisma `where` pra listar chamados visíveis ao viewer. Retorna
 * `undefined` quando o viewer é privileged (não filtra nada — só AND quando
 * vier objeto). Use: `where.AND = [...(prev), ticketVisibilityWhere(v)].filter(Boolean)`.
 */
export function ticketVisibilityWhere(v: Viewer): Record<string, unknown> | undefined {
  if (v.isPrivileged) return undefined;
  return {
    OR: [
      { visibility: "OPEN" },
      { setorId:    { in: v.setorIds } },
      { assigneeId: v.userId ?? NONE },
      { createdById: v.userId ?? NONE },
      { accessUsers: { some: { userId: v.userId ?? NONE } } },
    ],
  };
}

/** Fragmento Prisma `where` pra listar projetos visíveis ao viewer. */
export function projectVisibilityWhere(v: Viewer): Record<string, unknown> | undefined {
  if (v.isPrivileged) return undefined;
  return {
    OR: [
      { visibility: "OPEN" },
      { setorId:     { in: v.setorIds } },
      { members:     { some: { userId: v.userId ?? NONE } } },
      { accessUsers: { some: { userId: v.userId ?? NONE } } },
    ],
  };
}

/** Checagem de um chamado específico (já carregado). */
export function canSeeTicket(
  v: Viewer,
  t: {
    visibility?:   string | null;
    setorId?:      string | null;
    assigneeId?:   string | null;
    createdById?:  string | null;
    accessUserIds?: string[];
  },
): boolean {
  if (v.isPrivileged) return true;
  if (!t.visibility || t.visibility === "OPEN") return true;
  if (t.setorId && v.setorIds.includes(t.setorId)) return true;
  if (t.assigneeId && t.assigneeId === v.userId) return true;
  if (t.createdById && t.createdById === v.userId) return true;
  if (v.userId && (t.accessUserIds ?? []).includes(v.userId)) return true;
  return false;
}

/** Checagem de um projeto específico (já carregado). */
export function canSeeProject(
  v: Viewer,
  p: {
    visibility?:    string | null;
    setorId?:       string | null;
    memberIds?:     string[];
    accessUserIds?: string[];
  },
): boolean {
  if (v.isPrivileged) return true;
  if (!p.visibility || p.visibility === "OPEN") return true;
  if (p.setorId && v.setorIds.includes(p.setorId)) return true;
  if (v.userId && (p.memberIds ?? []).includes(v.userId)) return true;
  if (v.userId && (p.accessUserIds ?? []).includes(v.userId)) return true;
  return false;
}
