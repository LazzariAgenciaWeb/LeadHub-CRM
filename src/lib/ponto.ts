/**
 * Módulo Ponto — lógica de jornada, espelho mensal e validação de marcações.
 *
 * Controle de jornada GERENCIAL (não é REP-P da Portaria 671/2021): serve pro
 * dia-a-dia da equipe e pro espelho mensal que vai pro escritório de
 * contabilidade, com assinatura eletrônica simples do colaborador.
 *
 * Todas as contas de "dia" usam o timezone do sistema (SYSTEM_TIMEZONE) —
 * o servidor roda em UTC, então 22h de Brasília já é "amanhã" em UTC e
 * qualquer agrupamento ingênuo por Date quebraria a virada do dia.
 */

import { PunchSource, PunchType, TimeOffType } from "@/generated/prisma";
import { SYSTEM_TIMEZONE } from "@/lib/datetime";
import type { Espelho, EspelhoDay, EspelhoDayStatus } from "@/lib/ponto-shared";
import { PUNCH_LABEL, TIMEOFF_LABEL, WEEKDAY_SHORT, formatMin, monthLabel } from "@/lib/ponto-shared";

const TZ = SYSTEM_TIMEZONE;

// Rótulos e tipos serializáveis moram em ponto-shared.ts (sem import de
// Prisma — client components também usam). Re-exportados aqui por conveniência
// do lado servidor.
export { PUNCH_LABEL, TIMEOFF_LABEL, WEEKDAY_SHORT, formatMin, monthLabel };
export type { Espelho, EspelhoDay, EspelhoDayStatus };

// ─── Dia-calendário no TZ do sistema ─────────────────────────────────────────

/** Offset ISO do TZ pra uma data de referência (ex: "-03:00"). DST-aware. */
function tzOffsetISO(ref: Date): string {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" });
  const part = dtf.formatToParts(ref).find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  return part === "GMT" ? "+00:00" : part.slice(3);
}

/** "YYYY-MM-DD" do instante, no TZ do sistema. */
export function dayKeyInTZ(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/** "HH:MM" do instante, no TZ do sistema. */
export function timeHHMM(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

/** Instante UTC correspondente a `dayKey` às `hhmm` no TZ do sistema. */
export function dateAtTimeInTZ(dayKey: string, hhmm: string): Date {
  // Offset calculado com referência ao próprio dia (cobre eventual DST futuro).
  const approx = new Date(`${dayKey}T12:00:00Z`);
  return new Date(`${dayKey}T${hhmm}:00${tzOffsetISO(approx)}`);
}

/** 00:00 do dia-calendário no TZ do sistema (instante UTC). */
export function startOfDayKey(dayKey: string): Date {
  return dateAtTimeInTZ(dayKey, "00:00");
}

/** Todas as chaves "YYYY-MM-DD" de um mês (month 1–12). */
export function monthDayKeys(year: number, month: number): string[] {
  const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: total }, (_, i) =>
    `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`,
  );
}

/** Dia da semana (0=dom … 6=sáb) de uma chave de dia-calendário. */
export function weekdayOfKey(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Minutos desde 00:00 de um "HH:MM". */
export function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// ─── Sequência de marcações ──────────────────────────────────────────────────

/**
 * Quais tipos de marcação são válidos como PRÓXIMA batida, dado o que já foi
 * batido hoje. Sequência: ENTRADA → (INTERVALO_INICIO → INTERVALO_FIM)* → SAIDA.
 * Depois de SAIDA aceita nova ENTRADA (jornada quebrada / retorno extra).
 */
export function allowedNextPunches(punches: { type: PunchType }[]): PunchType[] {
  const last = punches[punches.length - 1]?.type;
  if (!last) return [PunchType.ENTRADA];
  switch (last) {
    case PunchType.ENTRADA:          return [PunchType.INTERVALO_INICIO, PunchType.SAIDA];
    case PunchType.INTERVALO_INICIO: return [PunchType.INTERVALO_FIM];
    case PunchType.INTERVALO_FIM:    return [PunchType.INTERVALO_INICIO, PunchType.SAIDA];
    case PunchType.SAIDA:            return [PunchType.ENTRADA];
  }
}

/** True se a lista (ordenada por horário) forma uma sequência de batidas válida. */
export function validPunchSequence(list: { type: PunchType }[]): boolean {
  if (list.length === 0) return false;
  const acc: { type: PunchType }[] = [];
  for (const p of list) {
    if (!allowedNextPunches(acc).includes(p.type)) return false;
    acc.push(p);
  }
  return true;
}

// ─── Cálculo de horas ────────────────────────────────────────────────────────

type PunchLike = { type: PunchType; timestamp: Date };

/**
 * Minutos trabalhados a partir das marcações de UM dia (ordenadas).
 * `countUntil`: se o relógio está "aberto" (ENTRADA/INTERVALO_FIM sem par),
 * conta até este instante — usado pro dia corrente. Sem countUntil, par
 * aberto não soma (dia passado incompleto).
 */
export function workedMinutes(punches: PunchLike[], countUntil?: Date): { minutes: number; open: boolean } {
  let total = 0;
  let openSince: Date | null = null;
  for (const p of punches) {
    if (p.type === PunchType.ENTRADA || p.type === PunchType.INTERVALO_FIM) {
      if (!openSince) openSince = p.timestamp;
    } else {
      if (openSince) {
        total += (p.timestamp.getTime() - openSince.getTime()) / 60_000;
        openSince = null;
      }
    }
  }
  if (openSince && countUntil) {
    total += Math.max(0, (countUntil.getTime() - openSince.getTime()) / 60_000);
  }
  return { minutes: Math.round(total), open: openSince !== null };
}

type ScheduleDayLike = {
  dayOfWeek: number;
  active: boolean;
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
};

/** Minutos esperados de um dia de jornada (desconta o intervalo previsto). */
export function expectedMinutesOf(day: ScheduleDayLike | undefined): number {
  if (!day || !day.active) return 0;
  let min = hhmmToMin(day.endTime) - hhmmToMin(day.startTime);
  if (day.breakStart && day.breakEnd) {
    min -= Math.max(0, hhmmToMin(day.breakEnd) - hhmmToMin(day.breakStart));
  }
  return Math.max(0, min);
}

// ─── Espelho mensal ──────────────────────────────────────────────────────────

type TimeOffLike = {
  type: TimeOffType;
  startDate: Date;
  endDate: Date;
  description: string | null;
};

export function buildEspelho(opts: {
  year: number;
  month: number; // 1–12
  punches: { type: PunchType; timestamp: Date; source: PunchSource }[];
  schedule: ScheduleDayLike[];
  timeOffs: TimeOffLike[];
  now?: Date;
}): Espelho {
  const now = opts.now ?? new Date();
  const todayKey = dayKeyInTZ(now);
  const schedByDow = new Map(opts.schedule.map((s) => [s.dayOfWeek, s]));

  // Agrupa marcações por dia-calendário no TZ
  const punchesByDay = new Map<string, typeof opts.punches>();
  for (const p of [...opts.punches].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())) {
    const key = dayKeyInTZ(p.timestamp);
    if (!punchesByDay.has(key)) punchesByDay.set(key, []);
    punchesByDay.get(key)!.push(p);
  }

  // Abonos indexados por range de chaves (inclusivo)
  const offRanges = opts.timeOffs.map((t) => ({
    ...t,
    startKey: dayKeyInTZ(t.startDate),
    endKey: dayKeyInTZ(t.endDate),
  }));

  const days: EspelhoDay[] = monthDayKeys(opts.year, opts.month).map((key) => {
    const weekday = weekdayOfKey(key);
    const sched = schedByDow.get(weekday);
    const scheduled = !!sched?.active;
    const off = offRanges.find((t) => key >= t.startKey && key <= t.endKey) ?? null;
    const dayPunches = punchesByDay.get(key) ?? [];
    const isToday = key === todayKey;
    const isFuture = key > todayKey;

    const { minutes, open } = workedMinutes(dayPunches, isToday ? now : undefined);
    const expectedMin = off || isFuture ? 0 : scheduled ? expectedMinutesOf(sched) : 0;

    let status: EspelhoDayStatus;
    if (isFuture)                 status = "FUTURO";
    else if (off)                 status = "ABONO";
    else if (isToday)             status = "HOJE";
    else if (dayPunches.length)   status = open ? "INCOMPLETO" : "OK";
    else if (scheduled)           status = "FALTA";
    else                          status = "SEM_JORNADA";

    return {
      key,
      weekday,
      punches: dayPunches.map((p) => ({ type: p.type, time: timeHHMM(p.timestamp), source: p.source })),
      timeOff: off?.type ?? null,
      timeOffDesc: off?.description ?? null,
      scheduled,
      expectedStart: scheduled ? sched!.startTime : null,
      expectedEnd: scheduled ? sched!.endTime : null,
      expectedMin,
      workedMin: minutes,
      status,
    };
  });

  const totals = days.reduce(
    (acc, d) => {
      acc.workedMin += d.workedMin;
      acc.expectedMin += d.expectedMin;
      if (d.status === "FALTA") acc.faltas += 1;
      if (d.status === "ABONO") acc.abonos += 1;
      if (d.workedMin > 0) acc.diasTrabalhados += 1;
      return acc;
    },
    { workedMin: 0, expectedMin: 0, balanceMin: 0, faltas: 0, abonos: 0, diasTrabalhados: 0 },
  );
  totals.balanceMin = totals.workedMin - totals.expectedMin;

  return { year: opts.year, month: opts.month, days, totals };
}

/** Range UTC [início, fim) de um mês no TZ do sistema — pra query no Prisma. */
export function monthRangeUTC(year: number, month: number): { gte: Date; lt: Date } {
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  return {
    gte: startOfDayKey(`${year}-${String(month).padStart(2, "0")}-01`),
    lt:  startOfDayKey(`${nextY}-${String(nextM).padStart(2, "0")}-01`),
  };
}

/** Parseia "?ym=2026-08" com fallback pro mês corrente. */
export function parseYm(ym: string | undefined): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(ym ?? "");
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) return { year, month };
  }
  const todayKey = dayKeyInTZ(new Date());
  return { year: Number(todayKey.slice(0, 4)), month: Number(todayKey.slice(5, 7)) };
}
