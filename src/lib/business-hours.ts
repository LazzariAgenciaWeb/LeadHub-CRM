/**
 * Cálculo de tempo de resposta dentro do horário comercial.
 *
 * Regra: se o cliente mandar mensagem fora do horário, o relógio começa
 * a contar somente quando o horário de atendimento abrir. Isso evita
 * que um atendente seja penalizado por mensagens recebidas às 23h.
 *
 * Configuração via variáveis de ambiente (ou defaults abaixo):
 *   BUSINESS_HOURS_START=9        hora de abertura (0-23)
 *   BUSINESS_HOURS_END=18         hora de fechamento (0-23, exclusive)
 *   BUSINESS_DAYS=1,2,3,4,5      dias úteis (0=dom, 6=sáb) — default seg-sex
 *   SYSTEM_TIMEZONE=America/Sao_Paulo
 */

const TZ = process.env.SYSTEM_TIMEZONE || "America/Sao_Paulo";
const START_HOUR = parseInt(process.env.BUSINESS_HOURS_START ?? "9", 10);
const END_HOUR   = parseInt(process.env.BUSINESS_HOURS_END   ?? "18", 10);
const WORK_DAYS  = (process.env.BUSINESS_DAYS ?? "1,2,3,4,5")
  .split(",")
  .map(Number);

/** Retorna os campos de data no fuso da empresa. */
function localParts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value])
  );
  return {
    year:    parseInt(parts.year,   10),
    month:   parseInt(parts.month,  10) - 1, // 0-indexed
    day:     parseInt(parts.day,    10),
    hour:    parseInt(parts.hour,   10),
    minute:  parseInt(parts.minute, 10),
    second:  parseInt(parts.second, 10),
    // Intl weekday: "Mon","Tue",...
    weekday: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(parts.weekday),
  };
}

/** Constrói um Date a partir de partes locais (no fuso da empresa). */
function fromLocalParts(
  year: number, month: number, day: number,
  hour: number, minute: number, second = 0
): Date {
  // Cria a string ISO sem offset e corrige usando o offset real do fuso
  const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  // Usa Temporal-like trick: parse como UTC e ajusta pelo offset do fuso
  const naive = new Date(iso + "Z");
  const tzOffset = getTimezoneOffsetMs(naive);
  return new Date(naive.getTime() - tzOffset);
}

/** Offset do fuso em milissegundos (positivo = atrás do UTC, ex: BRT = +3h = +10800000). */
function getTimezoneOffsetMs(date: Date): number {
  const utc = Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()
  );
  const local = new Date(date.toLocaleString("en-US", { timeZone: TZ }));
  return utc - local.getTime();
}

function isWorkday(weekday: number) {
  return WORK_DAYS.includes(weekday);
}

/**
 * Retorna o próximo instante de início do horário comercial >= `from`.
 * Se `from` já estiver dentro do horário, retorna `from` sem alterar.
 */
export function nextBusinessOpen(from: Date): Date {
  let cursor = new Date(from);
  for (let i = 0; i < 14; i++) { // max 2 semanas de busca
    const p = localParts(cursor);
    if (isWorkday(p.weekday) && p.hour >= START_HOUR && p.hour < END_HOUR) {
      return cursor; // já está dentro do horário
    }
    if (isWorkday(p.weekday) && p.hour < START_HOUR) {
      // mesmo dia, mas antes do horário abrir
      return fromLocalParts(p.year, p.month, p.day, START_HOUR, 0);
    }
    // fora do dia útil ou após o fechamento: avança para o próximo dia útil
    const nextDay = new Date(cursor);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const nextParts = localParts(nextDay);
    cursor = fromLocalParts(nextParts.year, nextParts.month, nextParts.day, START_HOUR, 0);
  }
  return cursor;
}

/**
 * Calcula quantos **minutos úteis** passaram entre `start` e `end`.
 *
 * Exemplo:
 *   start = sexta 17:50, end = segunda 09:10
 *   → 10 min na sexta + 10 min na segunda = 20 minutos úteis
 */
export function businessMinutesBetween(start: Date, end: Date): number {
  if (end <= start) return 0;

  let total = 0;
  let cursor = nextBusinessOpen(start);

  while (cursor < end) {
    const p = localParts(cursor);
    if (!isWorkday(p.weekday) || p.hour >= END_HOUR) {
      // avança para a próxima abertura
      const nextDay = new Date(cursor);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const np = localParts(nextDay);
      cursor = fromLocalParts(np.year, np.month, np.day, START_HOUR, 0);
      continue;
    }
    // fim deste bloco útil = min(fim do horário, end)
    const blockEnd = fromLocalParts(p.year, p.month, p.day, END_HOUR, 0);
    const effectiveEnd = end < blockEnd ? end : blockEnd;
    total += (effectiveEnd.getTime() - cursor.getTime()) / 60_000;
    // avança para o próximo dia útil
    const nextDay = new Date(cursor);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const np = localParts(nextDay);
    cursor = fromLocalParts(np.year, np.month, np.day, START_HOUR, 0);
  }

  return Math.round(total);
}

/**
 * Retorna true se `date` está dentro do horário comercial.
 */
export function isWithinBusinessHours(date: Date): boolean {
  const p = localParts(date);
  return isWorkday(p.weekday) && p.hour >= START_HOUR && p.hour < END_HOUR;
}

export const BUSINESS_START_HOUR = START_HOUR;
export const BUSINESS_END_HOUR   = END_HOUR;
export const BUSINESS_WORK_DAYS  = WORK_DAYS;
