/**
 * Testa nextFollowUpStep — a regra que decide SE uma conversa pode receber
 * follow-up. Função pura, roda sem banco.
 *
 * O caso que origina este teste: na clínica, o follow-up escreveu para
 * conversas de atendimento humano que nunca passaram pelo agente.
 *
 * Executar:
 *   npm run test:followup
 */

import { nextFollowUpStep, type FollowUpStep } from "../src/lib/auto-agent";

const STEPS: FollowUpStep[] = [{ delayMin: 360, text: "oi" }]; // 1 etapa, 6h
const NOW = new Date("2026-10-29T18:00:00Z").getTime();
const h = (n: number) => new Date(NOW - n * 3_600_000);

const AGENTE = { direction: "OUTBOUND", raw: { autoAgent: true, assistantId: "a1" } };
const ATENDENTE = { direction: "OUTBOUND", raw: null };
const CORTESIA = { direction: "OUTBOUND", raw: { autoAgent: true, courtesy: true } };
const CONTATO = { direction: "INBOUND", raw: null };

const ESCOPO_PADRAO = { trigger: true, requested: true };

function run(over: Partial<Parameters<typeof nextFollowUpStep>[0]>) {
  return nextFollowUpStep({
    stage: 0,
    exhaustedAt: null,
    lastMessageAt: h(7),
    scheduledReturnAt: null,
    aiMode: "ACTIVE",
    lastMsg: AGENTE,
    steps: STEPS,
    includeHuman: false,
    scopes: ESCOPO_PADRAO,
    engagedAt: null,
    requestedAt: null,
    armedAt: null,
    now: NOW,
    ...over,
  });
}

let pass = 0, fail = 0;
const falhas: string[] = [];
function check(label: string, got: unknown, expected: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else {
    fail++;
    const msg = `${label} — esperado ${JSON.stringify(expected)}, obtido ${JSON.stringify(got)}`;
    falhas.push(msg);
    console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
  }
}

console.log("\n\x1b[1;36m── escopo: quem pode ser cobrado ──\x1b[0m");

// O INCIDENTE: paciente comum, atendente respondeu, nunca passou pelo agente.
check(
  "conversa de atendente, sem campanha e sem pedido → fora do escopo",
  run({ lastMsg: ATENDENTE, aiMode: "PAUSED_HUMAN" }),
  { kind: "skip", reason: "fora_do_escopo" },
);
check(
  "mesma conversa com escopo amplo ligado → cobra",
  run({ lastMsg: ATENDENTE, aiMode: "PAUSED_HUMAN", includeHuman: true }),
  { kind: "send", stage: 0 },
);
check(
  "veio pela campanha + atendente respondeu e o contato sumiu → cobra",
  run({ lastMsg: ATENDENTE, aiMode: "PAUSED_HUMAN", engagedAt: h(30) }),
  { kind: "send", stage: 0 },
);
check(
  "veio pela campanha, mas o escopo está desligado → não cobra",
  run({ lastMsg: ATENDENTE, aiMode: "PAUSED_HUMAN", engagedAt: h(30), scopes: { trigger: false, requested: true } }),
  { kind: "skip", reason: "fora_do_escopo" },
);
check(
  "a própria IA falou por último e ainda é dona → cobra",
  run({}),
  { kind: "send", stage: 0 },
);

console.log("\n\x1b[1;36m── pedido manual do atendente ──\x1b[0m");

check(
  "pedido feito agora numa conversa parada há 5 dias → espera a etapa 1",
  run({ lastMsg: ATENDENTE, aiMode: "PAUSED_HUMAN", lastMessageAt: h(120), requestedAt: h(1) }),
  { kind: "skip", reason: "ainda_nao" },
);
check(
  "pedido feito há 7h → cobra (conta do pedido, não da fala antiga)",
  run({ lastMsg: ATENDENTE, aiMode: "PAUSED_HUMAN", lastMessageAt: h(120), requestedAt: h(7) }),
  { kind: "send", stage: 0 },
);
check(
  "pedido manual passa por cima do marco de ativação",
  run({ lastMsg: ATENDENTE, aiMode: "PAUSED_HUMAN", requestedAt: h(7), armedAt: h(1) }),
  { kind: "send", stage: 0 },
);
check(
  "pedido com o escopo desligado → não cobra",
  run({ lastMsg: ATENDENTE, aiMode: "PAUSED_HUMAN", requestedAt: h(7), scopes: { trigger: true, requested: false } }),
  { kind: "skip", reason: "fora_do_escopo" },
);

console.log("\n\x1b[1;36m── travas que valem para todo mundo ──\x1b[0m");

check("IA desligada na conversa", run({ aiMode: "OFF" }), { kind: "skip", reason: "ia_desligada" });
check("retorno já agendado pelo time", run({ scheduledReturnAt: h(-24) }), { kind: "skip", reason: "retorno_agendado" });
check("o contato falou por último", run({ lastMsg: CONTATO }), { kind: "skip", reason: "ultima_fala_do_contato" });
check("última fala é o aviso da sentinela", run({ lastMsg: CORTESIA }), { kind: "skip", reason: "aviso_da_sentinela" });
check("ainda não venceu a etapa", run({ lastMessageAt: h(2) }), { kind: "skip", reason: "ainda_nao" });
check("silêncio antigo (base de 7+ dias)", run({ lastMessageAt: h(24 * 9) }), { kind: "skip", reason: "silencio_antigo" });
check(
  "conversa parada antes de ligar o follow-up",
  run({ armedAt: h(1) }),
  { kind: "skip", reason: "anterior_a_ativacao" },
);
check("sem etapas configuradas", run({ steps: [] }), { kind: "skip", reason: "sem_etapas" });
check("já marcado como sem retorno", run({ exhaustedAt: h(2) }), { kind: "skip", reason: "esgotado" });
check(
  "última etapa enviada e 48h de silêncio → sem retorno",
  run({ stage: 1, lastMessageAt: h(50) }),
  { kind: "exhaust" },
);
check(
  "última etapa enviada há pouco → ainda espera",
  run({ stage: 1, lastMessageAt: h(10) }),
  { kind: "skip", reason: "aguardando_ultima" },
);

console.log(`\n\x1b[1m${pass} passou\x1b[0m  \x1b[31m${fail} falhou\x1b[0m`);
if (fail > 0) {
  console.log("\nFalhas:");
  falhas.forEach((m) => console.log(`  - ${m}`));
  process.exit(1);
}
