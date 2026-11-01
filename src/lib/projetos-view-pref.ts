import { prisma } from "@/lib/prisma";

// Visão padrão da tela de Projetos, por usuário: { view, groupBy, sortBy }.
// Fica em Setting (chave por usuário) pra valer em qualquer aparelho.

export const VIEWS = ["cards", "lista", "mapa", "kanban"] as const;
export const GROUPS = ["nenhum", "segmento", "setor", "cliente", "prazo"] as const;
export const SORTS = ["entrega", "nome", "cliente", "progresso", "atividade"] as const;

export type ViewPref = { view: (typeof VIEWS)[number]; groupBy: (typeof GROUPS)[number]; sortBy: (typeof SORTS)[number] };
export const DEFAULT_PREF: ViewPref = { view: "cards", groupBy: "segmento", sortBy: "entrega" };

export const prefKey = (userId: string) => `projetos_view:${userId}`;

export function parsePref(raw: unknown): ViewPref {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    view:    (VIEWS as readonly string[]).includes(String(o.view)) ? (o.view as ViewPref["view"]) : DEFAULT_PREF.view,
    groupBy: (GROUPS as readonly string[]).includes(String(o.groupBy)) ? (o.groupBy as ViewPref["groupBy"]) : DEFAULT_PREF.groupBy,
    sortBy:  (SORTS as readonly string[]).includes(String(o.sortBy)) ? (o.sortBy as ViewPref["sortBy"]) : DEFAULT_PREF.sortBy,
  };
}

export async function readPref(userId: string): Promise<ViewPref> {
  const row = await prisma.setting.findUnique({ where: { key: prefKey(userId) } }).catch(() => null);
  if (!row) return DEFAULT_PREF;
  try { return parsePref(JSON.parse(row.value)); } catch { return DEFAULT_PREF; }
}
