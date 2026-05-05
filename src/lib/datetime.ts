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

// ── Comparação por dia-calendário (timezone-aware) ───────────────────────────
// Por que existe: comparações tipo `due.getTime() < Date.now()` tratam um prazo
// "06/05 às 11h" como atrasado se já são 14h do dia 06 — só que o usuário
// considera "vence hoje" até o fim do dia. Mesma armadilha vale pra rótulo
// "Hoje/Amanhã" se calculado por diff de horas (24h não é o mesmo que mesmo dia).

function dayParts(d: Date): { y: number; m: number; day: number } {
  // Pega ano/mês/dia no timezone do sistema, não em UTC.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(d).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    day: Number(parts.day),
  };
}

/** True se as duas datas caem no MESMO dia-calendário (no timezone do sistema). */
export function isSameDay(a: Date | string, b: Date | string): boolean {
  const da = a instanceof Date ? a : new Date(a);
  const db = b instanceof Date ? b : new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  const A = dayParts(da);
  const B = dayParts(db);
  return A.y === B.y && A.m === B.m && A.day === B.day;
}

/** Diferença em dias-calendário (b − a). Mesmo dia = 0, ontem = -1, amanhã = +1. */
export function diffCalendarDays(a: Date | string, b: Date | string): number {
  const da = a instanceof Date ? a : new Date(a);
  const db = b instanceof Date ? b : new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 0;
  // UTC midnight do day-tag de cada uma → diferença robusta.
  const A = dayParts(da);
  const B = dayParts(db);
  const utcA = Date.UTC(A.y, A.m - 1, A.day);
  const utcB = Date.UTC(B.y, B.m - 1, B.day);
  return Math.round((utcB - utcA) / 86_400_000);
}

/**
 * True se o prazo já passou — considerando dia-calendário, não hora.
 * Ex: due=06/05 09h e now=06/05 14h → NÃO é atrasado (vence hoje no fim do dia).
 *     due=06/05 09h e now=07/05 00:01 → é atrasado.
 */
export function isOverdueByDay(due: Date | string, now: Date = new Date()): boolean {
  return diffCalendarDays(due, now) > 0;
}
