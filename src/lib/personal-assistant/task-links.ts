import { prisma } from "@/lib/prisma";
import { logNoteEvent } from "./note-events";

/**
 * Item do bloquinho ligado a tarefa(s) de projeto (AssistantNote.projectTaskIds).
 *
 * As rotinas mandam avisos do tipo "refazer a arte X — resolva na tarefa" com o
 * link /projetos/<pid>?tarefa=<id> no corpo. Aqui esse link vira vínculo: a UI
 * mostra "Abrir tarefa" e o aviso se conclui sozinho quando a tarefa fecha.
 * Só TASK/REMINDER se ligam — ideia/nota (ex.: resumo com vários links) não.
 */

const LINK_RE = /(?:https?:\/\/[^\s/]+)?\/projetos\/[\w-]+\?tarefa=([\w-]+)/g;
// Linha que só existe pra carregar o link do GoHub ("🔗 ABRIR A TAREFA (GoHub): …", "GoHub: …").
const LINK_LINE_RE = /^\s*(?:🔗\s*)?(?:abrir\s+(?:a|as)\s+tarefas?\s*)?\(?gohub\)?\s*:/i;

export const LINKABLE_KINDS = new Set(["TASK", "REMINDER"]);

export function extractTaskIds(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set([...text.matchAll(LINK_RE)].map((m) => m[1]))].slice(0, 10);
}

/** Tira as linhas que só carregavam o link do GoHub (viram botão na UI). */
export function stripTaskLinkLines(body: string | null): string | null {
  if (!body) return body;
  const out = body.split("\n").filter((l) => !(LINK_LINE_RE.test(l) && extractTaskIds(l).length > 0)).join("\n").trim();
  return out || null;
}

/** Mantém só as tarefas que existem e são da empresa. */
export async function validTaskIds(ids: string[], companyId: string | null): Promise<string[]> {
  if (!ids.length || !companyId) return [];
  const rows = await prisma.projectTask.findMany({ where: { id: { in: ids }, project: { setor: { companyId } } }, select: { id: true } });
  const ok = new Set(rows.map((r) => r.id));
  return ids.filter((id) => ok.has(id));
}

/** Título + link de cada tarefa (pra UI montar os botões). */
export async function taskInfo(ids: string[]): Promise<Map<string, { id: string; title: string; link: string; done: boolean }>> {
  const map = new Map<string, { id: string; title: string; link: string; done: boolean }>();
  if (!ids.length) return map;
  const rows = await prisma.projectTask.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, title: true, projectId: true, done: true } });
  for (const t of rows) map.set(t.id, { id: t.id, title: t.title, link: `/projetos/${t.projectId}?tarefa=${t.id}`, done: t.done });
  return map;
}

/**
 * Concilia os itens ligados a tarefas: (1) liga os antigos que só tinham o link
 * no texto; (2) conclui os que já não têm tarefa aberta. Sem userId = todos
 * (cron). Barato: só olha itens abertos com vínculo/link.
 */
export async function reconcileTaskNotes(userId?: string): Promise<number> {
  const scope = { done: false, ...(userId ? { userId } : {}) };

  // 1. Itens criados antes do vínculo existir (link solto no corpo).
  const loose = await prisma.assistantNote.findMany({
    where: { ...scope, kind: { in: [...LINKABLE_KINDS] }, projectTaskIds: { isEmpty: true }, body: { contains: "?tarefa=" } },
    select: { id: true, body: true, companyId: true },
    take: 200,
  });
  for (const n of loose) {
    const ids = await validTaskIds(extractTaskIds(n.body), n.companyId);
    if (ids.length) await prisma.assistantNote.update({ where: { id: n.id }, data: { projectTaskIds: ids, body: stripTaskLinkLines(n.body) } });
  }

  // 2. Fecha os que não têm mais tarefa aberta.
  const linked = await prisma.assistantNote.findMany({
    where: { ...scope, projectTaskIds: { isEmpty: false } },
    select: { id: true, projectTaskIds: true },
    take: 500,
  });
  if (!linked.length) return 0;
  const info = await taskInfo(linked.flatMap((n) => n.projectTaskIds));
  const now = new Date();
  let closed = 0;
  for (const n of linked) {
    const open = n.projectTaskIds.filter((id) => info.get(id) && !info.get(id)!.done);
    if (open.length) continue;
    const anyDone = n.projectTaskIds.some((id) => info.get(id)?.done);
    const doneNote = anyDone
      ? (n.projectTaskIds.length > 1 ? "As tarefas do projeto foram concluídas." : `Tarefa do projeto concluída: ${info.get(n.projectTaskIds[0])?.title ?? ""}`.trim())
      : "A tarefa do projeto foi excluída.";
    const r = await prisma.assistantNote.updateMany({ where: { id: n.id, done: false }, data: { done: true, doneAt: now, doneNote } });
    if (r.count) { closed++; await logNoteEvent(n.id, "DONE", "PROJETO", doneNote); }
  }
  return closed;
}
