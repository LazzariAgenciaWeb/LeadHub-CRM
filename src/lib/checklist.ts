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
