import { prisma } from "@/lib/prisma";

/**
 * Dependências de uma tarefa de projeto (`ProjectTask.dependsOnIds`): tarefas
 * do MESMO projeto que precisam estar concluídas antes desta. Só gera aviso na
 * tela ("Aguardando: …") — não trava status nem vai pro ClickUp.
 */
export const DEPS_MAX = 10;

function toIdList(raw: unknown): string[] {
  // Cliente MCP às vezes manda o array como texto JSON.
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try { raw = JSON.parse(raw); } catch { /* segue */ }
  }
  const list = Array.isArray(raw) ? raw : typeof raw === "string" && raw.trim() ? raw.split(",") : [];
  return Array.from(new Set(list.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)));
}

/**
 * Valida a lista nova de dependências de `taskId`: só tarefas do projeto, sem
 * ela mesma e sem fechar ciclo (A espera B que espera A — ninguém nunca começaria).
 */
export async function cleanDependencies(
  projectId: string,
  taskId: string,
  raw: unknown,
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const ids = toIdList(raw).filter((id) => id !== taskId);
  if (ids.length > DEPS_MAX) return { ok: false, error: `No máximo ${DEPS_MAX} dependências por tarefa.` };
  if (ids.length === 0) return { ok: true, ids: [] };

  const tasks = await prisma.projectTask.findMany({
    where:  { projectId },
    select: { id: true, title: true, dependsOnIds: true },
  });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const fora = ids.filter((id) => !byId.has(id));
  if (fora.length) return { ok: false, error: "Só dá pra depender de tarefa do mesmo projeto." };

  // Ciclo: a partir de cada dependência, segue as dependências dela; se chegar
  // de volta nesta tarefa, a ligação fecharia um círculo.
  const seen = new Set<string>();
  const stack = [...ids];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === taskId) {
      return { ok: false, error: "Essa dependência fecha um círculo (uma tarefa esperaria a outra pra sempre)." };
    }
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of byId.get(cur)?.dependsOnIds ?? []) stack.push(next);
  }
  return { ok: true, ids };
}
