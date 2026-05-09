/**
 * Testes unitários para layoutOverlappingEvents.
 *
 * Roda com:   npx tsx --test src/app/\(admin\)/calendario/event-layout.test.ts
 *
 * Usa apenas node:test + node:assert (built-ins) — sem framework extra.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutOverlappingEvents, type PositionableEvent } from "./event-layout";

// Helper: cria um evento com horários "HH:MM" no mesmo dia arbitrário.
function ev(start: string, end: string, label?: string): PositionableEvent & { label?: string } {
  const day = "2026-01-15";
  return {
    start: new Date(`${day}T${start}:00`),
    end:   new Date(`${day}T${end}:00`),
    label,
  };
}

test("array vazio devolve array vazio", () => {
  assert.deepEqual(layoutOverlappingEvents([]), []);
});

test("evento único ocupa lane 0 / laneCount 1", () => {
  const out = layoutOverlappingEvents([ev("09:00", "10:00")]);
  assert.equal(out.length, 1);
  assert.equal(out[0].lane, 0);
  assert.equal(out[0].laneCount, 1);
});

test("dois eventos sem sobreposição ficam ambos em lane 0 com laneCount 1", () => {
  const out = layoutOverlappingEvents([
    ev("09:00", "10:00", "A"),
    ev("11:00", "12:00", "B"),
  ]);
  // Eventos separados em clusters distintos — cada um ocupa 100% da largura.
  assert.equal(out.length, 2);
  for (const r of out) {
    assert.equal(r.lane, 0);
    assert.equal(r.laneCount, 1);
  }
});

test("dois eventos sobrepostos dividem a largura (2 lanes)", () => {
  const out = layoutOverlappingEvents([
    ev("09:00", "11:00", "A"),
    ev("10:00", "12:00", "B"),
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].laneCount, 2);
  assert.equal(out[1].laneCount, 2);
  // O primeiro a começar (A) fica na lane 0.
  assert.equal(out[0].lane, 0);
  assert.equal(out[1].lane, 1);
});

test("três eventos sobrepostos formam cluster de 3 lanes", () => {
  const out = layoutOverlappingEvents([
    ev("09:00", "12:00", "A"),
    ev("10:00", "11:30", "B"),
    ev("10:30", "11:00", "C"),
  ]);
  assert.equal(out.length, 3);
  for (const r of out) assert.equal(r.laneCount, 3);
  const lanes = out.map((r) => r.lane).sort();
  assert.deepEqual(lanes, [0, 1, 2]);
});

test("evento que termina exatamente quando outro começa NÃO sobrepõe", () => {
  // [09:00, 10:00) e [10:00, 11:00) — borda aberta, sem conflito.
  const out = layoutOverlappingEvents([
    ev("09:00", "10:00", "A"),
    ev("10:00", "11:00", "B"),
  ]);
  for (const r of out) {
    assert.equal(r.lane, 0);
    assert.equal(r.laneCount, 1);
  }
});

test("ordem de entrada não afeta o resultado (ordena por start)", () => {
  const a = ev("09:00", "11:00", "A");
  const b = ev("10:00", "12:00", "B");
  const order1 = layoutOverlappingEvents([a, b]);
  const order2 = layoutOverlappingEvents([b, a]);
  // Em ambos os casos, A (09:00) deve estar na lane 0.
  const findLabel = (out: ReturnType<typeof layoutOverlappingEvents>, label: string) =>
    out.find((r) => (r.event as any).label === label)!;
  assert.equal(findLabel(order1, "A").lane, 0);
  assert.equal(findLabel(order2, "A").lane, 0);
  assert.equal(findLabel(order1, "B").lane, 1);
  assert.equal(findLabel(order2, "B").lane, 1);
});

test("reúso de lane: terceiro evento entra na lane livre quando outro já terminou", () => {
  // A: 09:00–10:00 (lane 0)
  // B: 09:30–10:30 (lane 1, pois sobrepõe A)
  // C: 10:00–11:00 (lane 0 reaproveitada — A já acabou; mas ainda sobrepõe B → cluster de 2)
  const out = layoutOverlappingEvents([
    ev("09:00", "10:00", "A"),
    ev("09:30", "10:30", "B"),
    ev("10:00", "11:00", "C"),
  ]);
  const find = (l: string) => out.find((r) => (r.event as any).label === l)!;
  // Cluster transitivo: A↔B↔C → laneCount 2 pra todos.
  assert.equal(find("A").laneCount, 2);
  assert.equal(find("B").laneCount, 2);
  assert.equal(find("C").laneCount, 2);
  assert.equal(find("A").lane, 0);
  assert.equal(find("B").lane, 1);
  assert.equal(find("C").lane, 0); // lane 0 reaproveitada (A já terminou)
});

test("clusters independentes não influenciam laneCount um do outro", () => {
  // Cluster 1: A+B sobrepostos (manhã)
  // Cluster 2: C sozinho (tarde)
  // Cluster 3: D+E+F sobrepostos (noite)
  const out = layoutOverlappingEvents([
    ev("09:00", "11:00", "A"),
    ev("10:00", "12:00", "B"),
    ev("14:00", "15:00", "C"),
    ev("18:00", "20:00", "D"),
    ev("18:30", "19:30", "E"),
    ev("19:00", "21:00", "F"),
  ]);
  const find = (l: string) => out.find((r) => (r.event as any).label === l)!;
  assert.equal(find("A").laneCount, 2);
  assert.equal(find("B").laneCount, 2);
  assert.equal(find("C").laneCount, 1);
  assert.equal(find("D").laneCount, 3);
  assert.equal(find("E").laneCount, 3);
  assert.equal(find("F").laneCount, 3);
});

test("eventos idênticos no horário recebem lanes diferentes", () => {
  const out = layoutOverlappingEvents([
    ev("10:00", "11:00", "A"),
    ev("10:00", "11:00", "B"),
    ev("10:00", "11:00", "C"),
  ]);
  for (const r of out) assert.equal(r.laneCount, 3);
  const lanes = out.map((r) => r.lane).sort();
  assert.deepEqual(lanes, [0, 1, 2]);
});

test("não muta o array de entrada", () => {
  const input = [ev("10:00", "11:00", "B"), ev("09:00", "10:30", "A")];
  const snapshot = input.map((e) => ({ start: e.start, end: e.end }));
  layoutOverlappingEvents(input);
  assert.deepEqual(
    input.map((e) => ({ start: e.start, end: e.end })),
    snapshot,
  );
});

test("cluster transitivo reaproveita lane quando concorrência máxima é menor que o cluster", () => {
  // A: 09:00–10:30
  // B: 10:00–11:30  (sobrepõe A e C, é o "elo" transitivo)
  // C: 11:00–12:00  (não toca A — A já terminou às 10:30)
  // Concorrência máxima em qualquer instante = 2 (A+B ou B+C, nunca 3).
  // Algoritmo guloso reaproveita a lane 0 (A) pra C → laneCount = 2.
  const out = layoutOverlappingEvents([
    ev("09:00", "10:30", "A"),
    ev("10:00", "11:30", "B"),
    ev("11:00", "12:00", "C"),
  ]);
  const find = (l: string) => out.find((r) => (r.event as any).label === l)!;
  for (const r of out) assert.equal(r.laneCount, 2);
  assert.equal(find("A").lane, 0);
  assert.equal(find("B").lane, 1);
  assert.equal(find("C").lane, 0); // reaproveita a lane 0 (A já acabou)
});
