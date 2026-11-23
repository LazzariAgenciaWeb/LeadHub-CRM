/**
 * Etiquetas das tarefas de projeto (`ProjectTask.tags`). Texto livre, sem
 * cadastro: a etiqueta "existe" enquanto alguma tarefa da empresa usar. Serve
 * pra classificar o tipo de peça (Reels, Carrossel, Stories…) e filtrar.
 */
export const TAG_MAX = 30;
export const TAGS_PER_TASK = 10;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Aceita array ou "reels, carrossel". Apara, tira "#", junta repetidas (sem diferenciar maiúscula/acento). */
export function normalizeTags(raw: unknown): string[] {
  // Cliente MCP às vezes manda o array como texto JSON ('["Reels","Stories"]').
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try { raw = JSON.parse(raw); } catch { /* segue como texto separado por vírgula */ }
  }
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const v = item.trim().replace(/^#+/, "").trim().replace(/\s+/g, " ").slice(0, TAG_MAX);
    if (!v) continue;
    const k = fold(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= TAGS_PER_TASK) break;
  }
  return out;
}

export const sameTag = (a: string, b: string) => fold(a) === fold(b);

// Cor estável por etiqueta (mesmo nome = mesma cor em qualquer tela).
const TONES = [
  "bg-sky-500/15 text-sky-300 border-sky-500/30",
  "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "bg-rose-500/15 text-rose-300 border-rose-500/30",
  "bg-violet-500/15 text-violet-300 border-violet-500/30",
  "bg-teal-500/15 text-teal-300 border-teal-500/30",
  "bg-orange-500/15 text-orange-300 border-orange-500/30",
];
export function tagTone(tag: string): string {
  let h = 0;
  for (const ch of fold(tag)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}
