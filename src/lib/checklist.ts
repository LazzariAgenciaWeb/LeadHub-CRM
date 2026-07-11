// Checklist leve de sub-passos dentro de uma ProjectTask.
// Guardado como Json na coluna `checklist`: [{ text, done }].
// Sem tabela/rota própria — normalizado aqui pra entrar/sair seguro.

export type ChecklistItem = { text: string; done: boolean };

const MAX_ITEMS = 50;
const MAX_TEXT = 200;

/**
 * Normaliza um valor cru (body do request ou Json do banco) numa lista limpa.
 * Descarta itens sem texto, corta tamanho e limita a quantidade.
 * Retorna `null` se não sobrar nada (deixa a coluna limpa).
 */
export function sanitizeChecklist(raw: unknown): ChecklistItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: ChecklistItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const text = String((it as any).text ?? "").trim().slice(0, MAX_TEXT);
    if (!text) continue;
    items.push({ text, done: !!(it as any).done });
    if (items.length >= MAX_ITEMS) break;
  }
  return items.length ? items : null;
}

/** Lê um Json do banco como lista de itens (pra render). Nunca lança. */
export function readChecklist(raw: unknown): ChecklistItem[] {
  return sanitizeChecklist(raw) ?? [];
}

// ── Comentários / atualizações datadas de uma tarefa ────────────────────────
// Guardado como Json na coluna `comments`: [{ text, at }] (at = data ISO).

export type TaskComment = { text: string; at: string };

const MAX_COMMENTS = 100;
const MAX_COMMENT_TEXT = 2000;

export function sanitizeComments(raw: unknown): TaskComment[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TaskComment[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const text = String((it as any).text ?? "").trim().slice(0, MAX_COMMENT_TEXT);
    if (!text) continue;
    const rawAt = (it as any).at;
    const d = rawAt ? new Date(rawAt) : null;
    const at = d && !Number.isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
    out.push({ text, at });
    if (out.length >= MAX_COMMENTS) break;
  }
  return out.length ? out : null;
}

export function readComments(raw: unknown): TaskComment[] {
  return sanitizeComments(raw) ?? [];
}
