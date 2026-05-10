/**
 * Testa businessMinutesBetweenWithConfig — minutos úteis entre dois instantes
 * respeitando expediente seg-sex 9h-18h em America/Sao_Paulo.
 *
 * Executar:
 *   npx tsx scripts/test-business-hours.ts
 */

import { businessMinutesBetweenWithConfig, isWithinBusinessHoursConfig } from "../src/lib/business-hours";

const HOURS = Array.from({ length: 7 }, (_, d) => ({
  dayOfWeek: d, isOpen: d >= 1 && d <= 5,
  openTime: "09:00", closeTime: "18:00", intervals: [],
}));

const HOURS_LUNCH = Array.from({ length: 7 }, (_, d) => ({
  dayOfWeek: d, isOpen: d >= 1 && d <= 5,
  openTime: "09:00", closeTime: "18:00",
  intervals: [{ startTime: "12:00", endTime: "13:00" }],
}));

let pass = 0, fail = 0;
const failureMsgs: string[] = [];

function check(label: string, got: unknown, expected: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    fail++;
    const msg = `${label} — esperado ${JSON.stringify(expected)}, obtido ${JSON.stringify(got)}`;
    failureMsgs.push(msg);
    console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
  }
}

console.log("\n\x1b[1;36m── businessMinutesBetweenWithConfig ──\x1b[0m");

const cases: [string, Date, Date, any[], number][] = [
  ["09:00→09:30 BRT (início do expediente)",       new Date("2026-05-12T12:00:00Z"), new Date("2026-05-12T12:30:00Z"), HOURS, 30],
  ["14:00→14:30 BRT (meio do dia)",                new Date("2026-05-12T17:00:00Z"), new Date("2026-05-12T17:30:00Z"), HOURS, 30],
  ["17:05→17:25 BRT (fim do expediente)",          new Date("2026-05-12T20:05:00Z"), new Date("2026-05-12T20:25:00Z"), HOURS, 20],
  ["17:55→18:30 BRT (atravessa fechamento)",       new Date("2026-05-12T20:55:00Z"), new Date("2026-05-12T21:30:00Z"), HOURS, 5],
  ["08:30→09:30 BRT (atravessa abertura)",         new Date("2026-05-12T11:30:00Z"), new Date("2026-05-12T12:30:00Z"), HOURS, 30],
  ["18h ter→09h qua (overnight, sem horas úteis)", new Date("2026-05-12T21:00:00Z"), new Date("2026-05-13T12:00:00Z"), HOURS, 0],
  ["18h ter→10h qua (overnight + 1h dia seguinte)", new Date("2026-05-12T21:00:00Z"), new Date("2026-05-13T13:00:00Z"), HOURS, 60],
  ["sex 17h→seg 10h (pula fim de semana)",         new Date("2026-05-15T20:00:00Z"), new Date("2026-05-18T13:00:00Z"), HOURS, 120],
  ["sáb 12h→seg 10h (sábado não conta)",           new Date("2026-05-16T15:00:00Z"), new Date("2026-05-18T13:00:00Z"), HOURS, 60],
  ["mesmo instante (start = end)",                 new Date("2026-05-12T17:00:00Z"), new Date("2026-05-12T17:00:00Z"), HOURS, 0],
  ["end < start (retorna 0, não negativo)",        new Date("2026-05-12T17:30:00Z"), new Date("2026-05-12T17:00:00Z"), HOURS, 0],
  // Pausa de almoço 12h-13h
  ["11:30→13:30 com pausa 12-13",                  new Date("2026-05-12T14:30:00Z"), new Date("2026-05-12T16:30:00Z"), HOURS_LUNCH, 60],
  ["12:00→13:00 dentro da pausa",                  new Date("2026-05-12T15:00:00Z"), new Date("2026-05-12T16:00:00Z"), HOURS_LUNCH, 0],
];

for (const [label, a, b, hours, expected] of cases) {
  const got = businessMinutesBetweenWithConfig(a, b, hours);
  check(label, got, expected);
}

console.log("\n\x1b[1;36m── isWithinBusinessHoursConfig ──\x1b[0m");

const inHoursCases: [string, Date, any[], boolean][] = [
  ["ter 14h dentro",                new Date("2026-05-12T17:00:00Z"), HOURS, true],
  ["ter 18h fim (fora)",            new Date("2026-05-12T21:00:00Z"), HOURS, false],
  ["ter 08:59 antes da abertura",   new Date("2026-05-12T11:59:00Z"), HOURS, false],
  ["ter 09:00 abertura",            new Date("2026-05-12T12:00:00Z"), HOURS, true],
  ["sáb 14h",                       new Date("2026-05-16T17:00:00Z"), HOURS, false],
  ["dom 10h",                       new Date("2026-05-17T13:00:00Z"), HOURS, false],
  ["ter 12:30 dentro do almoço",    new Date("2026-05-12T15:30:00Z"), HOURS_LUNCH, false],
  ["ter 13:00 fim do almoço",       new Date("2026-05-12T16:00:00Z"), HOURS_LUNCH, true],
];

for (const [label, d, hours, expected] of inHoursCases) {
  const got = isWithinBusinessHoursConfig(d, hours);
  check(label, got, expected);
}

console.log(`\n\x1b[1m${pass} passou\x1b[0m  \x1b[31m${fail} falhou\x1b[0m`);
if (fail > 0) {
  console.log("\nFalhas:");
  failureMsgs.forEach((m) => console.log(`  - ${m}`));
  process.exit(1);
}
