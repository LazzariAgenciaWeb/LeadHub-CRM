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
// `cid` = id do comentário no ClickUp (quando o comentário foi empurrado pra lá
// ou veio de lá). Serve pra dedup e evitar eco no sync/webhook.
export type TaskCommentAttachment = { id: string; fileName: string; mimeType: string; size?: number };
export type TaskCommentLink = { url: string; title?: string };
export type TaskComment = {
  text: string;
  at: string;
  by?: "client";
  vis?: boolean;
  cid?: string;
  // Anexos/links atrelados a este comentário — resolvem o rastro de "essa
  // imagem veio nesta alteração pedida em X data". Os anexos são snapshots
  // de StoredFile (o binário mora no MinIO, servido via /api/storage/[id]).
  attachments?: TaskCommentAttachment[];
  links?: TaskCommentLink[];
};

const MAX_COMMENTS = 100;
const MAX_COMMENT_TEXT = 2000;
const MAX_ATTACHMENTS = 20;
const MAX_LINKS = 20;

export function sanitizeComments(raw: unknown): TaskComment[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TaskComment[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const text = String((it as any).text ?? "").trim().slice(0, MAX_COMMENT_TEXT);
    // Permite comentário SEM texto se tiver ao menos 1 anexo ou 1 link (ex.: só
    // "aqui está o arquivo novo"). Antes ficava fora e o cliente não via nada.
    const hasAttach = Array.isArray((it as any).attachments) && (it as any).attachments.length > 0;
    const hasLinks  = Array.isArray((it as any).links)       && (it as any).links.length > 0;
    if (!text && !hasAttach && !hasLinks) continue;
    const rawAt = (it as any).at;
    const d = rawAt ? new Date(rawAt) : null;
    const at = d && !Number.isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
    const c: TaskComment = { text, at };
    if ((it as any).by === "client") c.by = "client"; // resposta do cliente
    if ((it as any).vis === false) c.vis = false; // marcado como interno
    if (typeof (it as any).cid === "string" && (it as any).cid) c.cid = (it as any).cid; // id no ClickUp
    if (hasAttach) {
      const atts: TaskCommentAttachment[] = [];
      for (const a of (it as any).attachments as unknown[]) {
        if (!a || typeof a !== "object") continue;
        const id = String((a as any).id ?? "").trim();
        const fileName = String((a as any).fileName ?? "").trim();
        const mimeType = String((a as any).mimeType ?? "application/octet-stream").trim();
        if (!id || !fileName) continue;
        const size = typeof (a as any).size === "number" ? (a as any).size : undefined;
        atts.push({ id, fileName, mimeType, size });
        if (atts.length >= MAX_ATTACHMENTS) break;
      }
      if (atts.length) c.attachments = atts;
    }
    if (hasLinks) {
      const links: TaskCommentLink[] = [];
      for (const l of (it as any).links as unknown[]) {
        if (!l || typeof l !== "object") continue;
        const url = String((l as any).url ?? "").trim().slice(0, 2000);
        if (!url) continue;
        const title = String((l as any).title ?? "").trim().slice(0, 200);
        links.push(title ? { url, title } : { url });
        if (links.length >= MAX_LINKS) break;
      }
      if (links.length) c.links = links;
    }
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
