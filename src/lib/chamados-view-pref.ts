import { prisma } from "@/lib/prisma";

// Visão padrão da tela de Chamados, por usuário: { view, groupBy, sortBy }.
// Mesmo esquema de Projetos (lib/projetos-view-pref): fica em Setting com
// chave por usuário, pra valer em qualquer aparelho.

export const VIEWS = ["lista", "kanban"] as const;
export const GROUPS = ["etapa", "prazo", "cliente", "responsavel", "nenhum"] as const;
export const SORTS = ["urgencia", "prazo", "prioridade", "cliente", "atividade"] as const;

export type ChamadosViewPref = {
  view: (typeof VIEWS)[number];
  groupBy: (typeof GROUPS)[number];
  sortBy: (typeof SORTS)[number];
};
export const DEFAULT_PREF: ChamadosViewPref = { view: "lista", groupBy: "etapa", sortBy: "urgencia" };

export const prefKey = (userId: string) => `chamados_view:${userId}`;

const pick = <T extends readonly string[]>(list: T, v: unknown, fallback: T[number]): T[number] =>
  (list as readonly string[]).includes(String(v)) ? (v as T[number]) : fallback;

export function parsePref(raw: unknown): ChamadosViewPref {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    view:    pick(VIEWS, o.view, DEFAULT_PREF.view),
    groupBy: pick(GROUPS, o.groupBy, DEFAULT_PREF.groupBy),
    sortBy:  pick(SORTS, o.sortBy, DEFAULT_PREF.sortBy),
  };
}

export async function readPref(userId: string): Promise<ChamadosViewPref> {
  if (!userId) return DEFAULT_PREF;
  const row = await prisma.setting.findUnique({ where: { key: prefKey(userId) } }).catch(() => null);
  if (!row) return DEFAULT_PREF;
  try { return parsePref(JSON.parse(row.value)); } catch { return DEFAULT_PREF; }
}
