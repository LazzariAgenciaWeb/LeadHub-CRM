/** Normaliza etiquetas do bloquinho: minúsculas, sem #, sem repetição, máx. 6. */
export function parseTags(t: unknown): string[] {
  const arr = Array.isArray(t) ? t : typeof t === "string" ? t.split(/[,;]/) : [];
  return [...new Set(arr.filter((x): x is string => typeof x === "string").map((x) => x.trim().toLowerCase().replace(/^#/, "")).filter(Boolean))].slice(0, 6);
}
