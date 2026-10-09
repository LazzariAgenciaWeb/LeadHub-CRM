import { prisma } from "@/lib/prisma";
import { logNoteEvent } from "./note-events";

/**
 * Deduplicação do bloquinho.
 *
 * Rotinas (Gmail, reels, alertas) rodam várias vezes e tendem a registrar o
 * mesmo assunto de novo. Antes de criar, procuramos um item ABERTO do usuário
 * parecido (título/assunto). Se achar, acrescentamos o conteúdo novo no corpo
 * dele — com data e origem — em vez de criar outro. Vale pra todas as portas,
 * porque roda dentro das ferramentas/webhook, não no prompt.
 */

const STOP = new Set(["de", "da", "do", "das", "dos", "a", "o", "as", "os", "e", "em", "no", "na", "nos", "nas", "um", "uma", "para", "pra", "por", "com", "sem", "que", "se", "ao", "aos", "the", "and", "of", "to", "re", "fw", "fwd", "responder", "reels", "email", "e-mail", "lembrar", "lembrete", "tarefa", "nota", "ideia", "sobre", "novo", "nova", "gravar", "verificar", "ver"]);

export function normalizeText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s@._-]/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(s: string): Set<string> {
  return new Set(normalizeText(s).split(" ").filter((t) => t.length >= 3 && !STOP.has(t)));
}

/** 0..1 — Jaccard de tokens + bônus por um título conter o outro. */
export function similarity(a: string, b: string): number {
  const na = normalizeText(a), nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if ((na.length >= 12 && nb.includes(na)) || (nb.length >= 12 && na.includes(nb))) return 0.9;
  const ta = tokens(a), tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  const j = inter / union;
  // dois tokens fortes em comum já é indício (ex.: "proposta clinica", "banner padaria")
  return inter >= 2 ? Math.max(j, 0.5) : j;
}

const THRESHOLD = 0.5;
const LOOKBACK_DAYS = 45;

export interface SimilarNote { id: string; title: string; body: string | null; tags: string[]; dueAt: Date | null; kind: string; score: number }

/** Procura item aberto parecido (título, link ou cliente). */
export async function findSimilarOpenNote(userId: string, title: string, opts?: { body?: string | null; clientCompanyId?: string | null; kind?: string }): Promise<SimilarNote | null> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000);
  const candidates = await prisma.assistantNote.findMany({
    where: { userId, done: false, createdAt: { gte: since } },
    select: { id: true, title: true, body: true, tags: true, dueAt: true, kind: true, clientCompanyId: true },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
  const link = opts?.body?.match(/https?:\/\/[^\s)]+/)?.[0] ?? null;
  let best: SimilarNote | null = null;
  for (const c of candidates) {
    let score = similarity(title, c.title);
    // mesmo link (tarefa do ClickUp, e-mail) = mesmo assunto
    if (link && c.body && c.body.includes(link)) score = Math.max(score, 0.95);
    // mesmo cliente + algum tema em comum reforça
    if (opts?.clientCompanyId && c.clientCompanyId === opts.clientCompanyId && score >= 0.3) score = Math.max(score, 0.55);
    if (score >= THRESHOLD && (!best || score > best.score)) best = { ...c, score };
  }
  return best;
}

/** Acrescenta conteúdo novo ao item existente (corpo, etiquetas, prazo) e registra no histórico. */
export async function appendToNote(noteId: string, add: { title?: string; body?: string | null; tags?: string[]; dueAt?: Date | null; source: string; sourceLabel?: string }): Promise<{ title: string }> {
  const n = await prisma.assistantNote.findUnique({ where: { id: noteId }, select: { title: true, body: true, tags: true, dueAt: true } });
  if (!n) throw new Error("Item não encontrado");
  const stamp = new Date().toLocaleString("pt-BR", { timeZone: process.env.SYSTEM_TIMEZONE || "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const origem = add.sourceLabel ?? add.source.toLowerCase();
  const pieces: string[] = [];
  if (add.title && similarity(add.title, n.title) < 0.95) pieces.push(add.title.trim());
  if (add.body?.trim()) {
    // evita colar o mesmo texto duas vezes
    const already = n.body && normalizeText(n.body).includes(normalizeText(add.body).slice(0, 80));
    if (!already) pieces.push(add.body.trim());
  }
  const addition = pieces.length ? `\n\n— ${stamp} (${origem}):\n${pieces.join("\n")}` : "";
  const tags = [...new Set([...(n.tags ?? []), ...(add.tags ?? [])])].slice(0, 8);
  // prazo: fica o mais próximo (se o novo for antes, antecipa; se não tinha, define)
  let dueAt = n.dueAt;
  if (add.dueAt && (!dueAt || add.dueAt < dueAt)) dueAt = add.dueAt;

  await prisma.assistantNote.update({
    where: { id: noteId },
    data: { body: `${n.body ?? ""}${addition}`.trim() || null, tags, dueAt, ...(dueAt !== n.dueAt ? { remindedAt: null } : {}) },
  });
  await logNoteEvent(noteId, "APPENDED", add.source, pieces.length ? pieces.join(" · ").slice(0, 300) : "mesmo assunto, sem conteúdo novo");
  return { title: n.title };
}
