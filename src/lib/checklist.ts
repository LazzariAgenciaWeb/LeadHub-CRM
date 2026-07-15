// Checklist leve de sub-passos dentro de uma ProjectTask.
// Guardado como Json na coluna `checklist`: [{ text, done }].
// Sem tabela/rota própria — normalizado aqui pra entrar/sair seguro.

export type ChecklistItem = { text: string; done: boolean; doneAt: string | null };

const MAX_ITEMS = 50;
const MAX_TEXT = 200;

/**
 * Normaliza um valor cru (body do request ou Json do banco) numa lista limpa.
 * Descarta itens sem texto, corta tamanho e limita a quantidade. Guarda `doneAt`
 * (data/hora de conclusão) só quando o item está concluído.
 * Retorna `null` se não sobrar nada (deixa a coluna limpa).
 */
export function sanitizeChecklist(raw: unknown): ChecklistItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: ChecklistItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const text = String((it as any).text ?? "").trim().slice(0, MAX_TEXT);
    if (!text) continue;
    const done = !!(it as any).done;
    let doneAt: string | null = null;
    if (done) {
      const rawAt = (it as any).doneAt;
      const d = rawAt ? new Date(rawAt) : null;
      doneAt = d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
    }
    items.push({ text, done, doneAt });
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

// `vis: false` = comentário interno (a equipe vê no admin, o cliente NÃO vê).
// Ausente = visível pro cliente (comportamento padrão). Resposta do cliente
// (by:"client") é sempre visível pra ele.
export type TaskComment = { text: string; at: string; by?: "client"; vis?: boolean };

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
    const c: TaskComment = { text, at };
    if ((it as any).by === "client") c.by = "client"; // resposta do cliente
    if ((it as any).vis === false) c.vis = false; // marcado como interno
    out.push(c);
    if (out.length >= MAX_COMMENTS) break;
  }
  return out.length ? out : null;
}

export function readComments(raw: unknown): TaskComment[] {
  return sanitizeComments(raw) ?? [];
}

/**
 * Comentários que o CLIENTE pode ver: a própria resposta dele + os da equipe
 * que não estão marcados como internos (vis !== false). Usado nas leituras do
 * painel do cliente (/c/[token] e /meu-espaco).
 */
export function clientComments(raw: unknown): TaskComment[] {
  return readComments(raw).filter((c) => c.by === "client" || c.vis !== false);
}
