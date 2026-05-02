/**
 * Cálculo de tempo de resposta dentro do horário comercial.
 *
 * Dois modos:
 *   1. Por empresa (recomendado) — carrega config do banco via loadCompanyHours()
 *      e usa businessMinutesBetweenWithConfig().
 *   2. Fallback por env vars — usado quando a empresa não tem config no banco.
 *
 * Variáveis de ambiente (fallback):
 *   BUSINESS_HOURS_START=9        hora de abertura (0-23)
 *   BUSINESS_HOURS_END=18         hora de fechamento (0-23, exclusive)
 *   BUSINESS_DAYS=1,2,3,4,5      dias úteis (0=dom, 6=sáb)
 *   SYSTEM_TIMEZONE=America/Sao_Paulo
 */

import { prisma } from "@/lib/prisma";

export const SYSTEM_TIMEZONE = process.env.SYSTEM_TIMEZONE || "America/Sao_Paulo";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type HoursInterval = {
  startTime: string; // "HH:MM"
  endTime:   string; // "HH:MM"
};

export type DayConfig = {
  dayOfWeek: number;       // 0=dom … 6=sáb
  isOpen:    boolean;
  openTime:  string;       // "HH:MM"
  closeTime: string;       // "HH:MM"
  intervals: HoursInterval[]; // pausas dentro do dia (almoço, etc.)
};

export type CompanyHoursConfig = DayConfig[];

// ─── Defaults por env vars ────────────────────────────────────────────────────

const ENV_START = parseInt(process.env.BUSINESS_HOURS_START ?? "9", 10);
const ENV_END   = parseInt(process.env.BUSINESS_HOURS_END   ?? "18", 10);
const ENV_DAYS  = (process.env.BUSINESS_DAYS ?? "1,2,3,4,5").split(",").map(Number);

function envFallbackConfig(): CompanyHoursConfig {
  return Array.from({ length: 7 }, (_, d) => ({
    dayOfWeek: d,
    isOpen:    ENV_DAYS.includes(d),
    openTime:  `${String(ENV_START).padStart(2, "0")}:00`,
    closeTime: `${String(ENV_END).padStart(2, "0")}:00`,
    intervals: [],
  }));
}

// ─── Carregamento do banco ────────────────────────────────────────────────────

/**
 * Carrega a config de horário da empresa do banco.
 * Retorna defaults (env vars) se a empresa não tiver configuração salva.
 * Só pode ser chamado server-side (usa prisma).
 */
export async function loadCompanyHours(companyId: string): Promise<CompanyHoursConfig> {
  const rows = await prisma.businessHoursConfig.findMany({
    where:   { companyId },
    include: { intervals: { orderBy: { startTime: "asc" } } },
    orderBy: { dayOfWeek: "asc" },
  });

  if (rows.length === 0) return envFallbackConfig();

  // Completa eventuais dias ausentes com defaults
  const byDay = new Map(rows.map((r) => [r.dayOfWeek, r]));
  const fallback = envFallbackConfig();
  return Array.from({ length: 7 }, (_, d) => {
    const row = byDay.get(d);
    if (row) {
      return {
        dayOfWeek: row.dayOfWeek,
        isOpen:    row.isOpen,
        openTime:  row.openTime,
        closeTime: row.closeTime,
        intervals: row.intervals.map((iv) => ({ startTime: iv.startTime, endTime: iv.endTime })),
      };
    }
    return fallback[d];
  });
}

// ─── Utilitários de tempo ─────────────────────────────────────────────────────

/** Converte "HH:MM" em total de minutos desde meia-noite. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Retorna os campos de data no fuso da empresa. */
function localParts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: SYSTEM_TIMEZONE,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year:    parseInt(parts.year,   10),
    month:   parseInt(parts.month,  10) - 1,
    day:     parseInt(parts.day,    10),
    hour:    parseInt(parts.hour,   10),
    minute:  parseInt(parts.minute, 10),
    second:  parseInt(parts.second, 10),
    weekday: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(parts.weekday),
    minutesFromMidnight: parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10),
  };
}

/** Constrói um Date a partir de partes no fuso local (SYSTEM_TIMEZONE). */
function fromLocalParts(year: number, month: number, day: number, hhmm: string): Date {
  const [hh, mm] = hhmm.split(":").map(Number);
  const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
  const naive = new Date(iso + "Z");
  const tzOffset = getTimezoneOffsetMs(naive);
  return new Date(naive.getTime() - tzOffset);
}

function getTimezoneOffsetMs(date: Date): number {
  const utc   = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
                         date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds());
  const local = new Date(date.toLocaleString("en-US", { timeZone: SYSTEM_TIMEZONE }));
  return utc - local.getTime();
}

/**
 * Retorna os blocos de tempo útil de um dia específico, já subtraídos os intervalos.
 * Cada bloco é [startMinutes, endMinutes] em minutos desde meia-noite.
 */
function workBlocksForDay(cfg: DayConfig): Array<[number, number]> {
  if (!cfg.isOpen) return [];

  const open  = toMinutes(cfg.openTime);
  const close = toMinutes(cfg.closeTime);
  if (open >= close) return [];

  // Começa com um único bloco [open, close] e subtrai intervalos
  let blocks: Array<[number, number]> = [[open, close]];

  for (const iv of cfg.intervals) {
    const ivStart = toMinutes(iv.startTime);
    const ivEnd   = toMinutes(iv.endTime);
    if (ivStart >= ivEnd) continue;

    const next: Array<[number, number]> = [];
    for (const [bs, be] of blocks) {
      // Sem sobreposição: mantém o bloco inteiro
      if (ivEnd <= bs || ivStart >= be) {
        next.push([bs, be]);
        continue;
      }
      // Parte antes do intervalo
      if (ivStart > bs) next.push([bs, ivStart]);
      // Parte depois do intervalo
      if (ivEnd < be) next.push([ivEnd, be]);
    }
    blocks = next;
  }

  return blocks;
}

// ─── API principal ────────────────────────────────────────────────────────────

/**
 * Calcula quantos **minutos úteis** passaram entre `start` e `end`,
 * usando a configuração de horário específica da empresa.
 *
 * Regra: se o cliente mandar mensagem fora do horário, o relógio começa
 * no próximo instante de abertura do horário comercial.
 */
export function businessMinutesBetweenWithConfig(
  start: Date,
  end:   Date,
  config: CompanyHoursConfig
): number {
  if (end <= start) return 0;

  let total   = 0;
  let cursor  = new Date(start);

  // Itera dia a dia até chegar em `end` (max 60 dias de segurança)
  for (let guard = 0; guard < 60; guard++) {
    const p = localParts(cursor);
    const dayCfg = config[p.weekday];

    if (!dayCfg?.isOpen) {
      cursor = advanceToNextOpenDay(cursor, config);
      if (cursor >= end) break;
      continue;
    }

    const blocks = workBlocksForDay(dayCfg);
    const { year, month, day } = p;

    let advancedInDay = false;
    for (const [bs, be] of blocks) {
      const blockStart = fromLocalParts(year, month, day, minutesToHHMM(bs));
      const blockEnd   = fromLocalParts(year, month, day, minutesToHHMM(be));

      if (blockEnd <= cursor) continue;       // bloco já passou
      if (blockStart >= end)  { advancedInDay = true; break; } // além de `end`

      const effectiveStart = cursor > blockStart ? cursor : blockStart;
      const effectiveEnd   = end   < blockEnd   ? end   : blockEnd;
      total += (effectiveEnd.getTime() - effectiveStart.getTime()) / 60_000;

      if (effectiveEnd >= end) return Math.round(total);
    }

    if (advancedInDay || cursor < end) {
      cursor = advanceToNextOpenDay(cursor, config);
      if (cursor >= end) break;
    }
  }

  return Math.round(total);
}

/**
 * Atalho que carrega config do banco e calcula.
 * Preferir esta versão em rotas de API.
 */
export async function businessMinutesBetweenForCompany(
  start:     Date,
  end:       Date,
  companyId: string
): Promise<number> {
  const config = await loadCompanyHours(companyId);
  return businessMinutesBetweenWithConfig(start, end, config);
}

/**
 * Verifica se `date` está dentro do horário comercial da empresa.
 */
export function isWithinBusinessHoursConfig(date: Date, config: CompanyHoursConfig): boolean {
  const p      = localParts(date);
  const dayCfg = config[p.weekday];
  if (!dayCfg?.isOpen) return false;

  const nowMin = p.minutesFromMidnight;
  const open   = toMinutes(dayCfg.openTime);
  const close  = toMinutes(dayCfg.closeTime);
  if (nowMin < open || nowMin >= close) return false;

  // Verifica se está dentro de um intervalo (pausa)
  for (const iv of dayCfg.intervals) {
    if (nowMin >= toMinutes(iv.startTime) && nowMin < toMinutes(iv.endTime)) return false;
  }
  return true;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function advanceToNextOpenDay(from: Date, config: CompanyHoursConfig): Date {
  let next = new Date(from);
  for (let i = 0; i < 8; i++) {
    // Avança para o início do próximo dia
    next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
    const p = localParts(next);
    const dayCfg = config[p.weekday];
    if (dayCfg?.isOpen && workBlocksForDay(dayCfg).length > 0) {
      const firstBlock = workBlocksForDay(dayCfg)[0];
      return fromLocalParts(p.year, p.month, p.day, minutesToHHMM(firstBlock[0]));
    }
  }
  return next; // fallback (nunca deve chegar aqui com config válida)
}

// ─── Exports legados (compatibilidade com código existente) ───────────────────

/** @deprecated Use businessMinutesBetweenForCompany quando tiver companyId. */
export function businessMinutesBetween(start: Date, end: Date): number {
  return businessMinutesBetweenWithConfig(start, end, envFallbackConfig());
}

export function isWithinBusinessHours(date: Date): boolean {
  return isWithinBusinessHoursConfig(date, envFallbackConfig());
}

export const BUSINESS_START_HOUR = ENV_START;
export const BUSINESS_END_HOUR   = ENV_END;
export const BUSINESS_WORK_DAYS  = ENV_DAYS;
