/**
 * Helpers de formatação de data/hora pra horário de Brasília (UTC-3).
 *
 * Por que existe: o servidor (container Docker) tipicamente roda em UTC,
 * então `Date.toLocaleString("pt-BR")` sem timeZone explícito devolve
 * o horário UTC. Usuário marca 8h, vê 11h — diff de 3h.
 *
 * Estes helpers forçam o timezone correto. Se precisar mudar (cliente
 * em outro fuso), defina SYSTEM_TIMEZONE no .env (ex: "America/Manaus").
 */

const TZ = process.env.SYSTEM_TIMEZONE || "America/Sao_Paulo";

/** "DD/MM/AAAA HH:MM" — usado em texto de notas, e-mails, etc. */
export function formatBrazilDateTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", {
    timeZone: TZ,
    day:    "2-digit",
    month:  "2-digit",
    year:   "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });
}

/** "DD/MM/AA HH:MM" — formato compacto usado no prefixo de Lead.notes legado. */
export function formatBrazilDateTimeShort(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const dateStr = date.toLocaleDateString("pt-BR", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit",
  });
  const timeStr = date.toLocaleTimeString("pt-BR", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit",
  });
  return `${dateStr} ${timeStr}`;
}

/** "DD/MM/AAAA" sem hora. */
export function formatBrazilDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric",
  });
}

/** Identificador do timezone em uso — útil pra exibir e debug. */
export const SYSTEM_TIMEZONE = TZ;
