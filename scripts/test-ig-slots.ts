/**
 * Testa o casamento do horário escolhido no Direct — a regra que decide em qual
 * horário a reunião é criada de verdade na agenda do Diego.
 *
 * Erra pra mais: marca o horário errado (evento real, pessoa plantada no Meet
 * sozinha). Erra pra menos: fica pedindo o horário de novo e queima o lead.
 * Função pura, roda sem banco.
 *
 * Executar:
 *   npm run test:ig-slots
 */

import { resolveIgSlot, slotsWeOffered } from "../src/lib/ig-auto-agent";

type Slot = { startISO: string; label: string; period: "manha" | "tarde" };

const SLOTS: Slot[] = [
  { startISO: "2026-11-05T09:00:00-03:00", label: "qui 05/11 09:00", period: "manha" },
  { startISO: "2026-11-05T14:00:00-03:00", label: "qui 05/11 14:00", period: "tarde" },
  { startISO: "2026-11-06T10:30:00-03:00", label: "sex 06/11 10:30", period: "manha" },
  { startISO: "2026-11-06T19:00:00-03:00", label: "sex 06/11 19:00", period: "tarde" },
];

const OFERTA = "Tenho qui 05/11 às 09:00 ou qui 05/11 às 14:00 — qual fica melhor pra você?";

let falhas = 0;
function check(nome: string, obtido: string | null, esperado: string | null) {
  if (obtido === esperado) return;
  falhas++;
  console.error(`✗ ${nome}\n    esperado: ${esperado}\n    obtido:   ${obtido}`);
}

const oferecidos = slotsWeOffered(OFERTA, SLOTS);
check("a oferta reconhece os 2 horários", String(oferecidos.length), "2");

const r = (code: string | null, texto: string, oferta = OFERTA) =>
  resolveIgSlot(SLOTS, code, texto, slotsWeOffered(oferta, SLOTS))?.label ?? null;

check("código do JSON manda", r("S2", "qualquer coisa"), "qui 05/11 14:00");
check("código entre colchetes", r("[S1]", "qualquer coisa"), "qui 05/11 09:00");
check("dia + hora no texto", r(null, "pode ser dia 6/11 às 10:30"), "sex 06/11 10:30");
check("dia da semana + hora", r(null, "quinta às 14h fica bom"), "qui 05/11 14:00");
check("só a hora, entre os oferecidos", r(null, "às 9 fica ótimo"), "qui 05/11 09:00");
check("9h não casa com 19h", r(null, "pode ser 19h"), null);
check("aceite com uma oferta só", r(null, "pode ser, fechado", "Consigo qui 05/11 às 09:00 — fecha pra você?"), "qui 05/11 09:00");
check("aceite com duas ofertas é ambíguo", r(null, "pode ser"), null);
check("sem oferta nossa, sem horário", r(null, "quero conversar", "Oi! Tudo bem?"), null);

if (falhas) {
  console.error(`\n${falhas} teste(s) falharam.`);
  process.exit(1);
}
console.log("✓ horários do Direct: 10 casos ok");
