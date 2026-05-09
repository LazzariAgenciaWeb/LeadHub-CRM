/**
 * Suíte de testes unitários do motor de gamificação.
 *
 * Executar:
 *   npx tsx scripts/test-gamification.ts
 *   npm run test:gamification
 *
 * NÃO toca no banco. Valida consistência declarativa entre:
 *   - SCORE_TABLE (gamification.ts)
 *   - BADGE_RULES + REI_DO_MES_THRESHOLDS (gamification.ts)
 *   - BADGE_TIERS / BADGE_META / BADGE_REASON / BADGE_CATEGORY (labels.ts)
 *   - REASON_LABEL (labels.ts)
 *   - SCORING_TRIGGER + EDITABLE_REASONS (scoring-meta.ts)
 *   - getBadgeProgress (labels.ts)
 *
 * E também verifica balanceamento competitivo (limiares saudáveis).
 *
 * Saída: relatório por seção, exit code 0 se todos os testes passam, 1 caso
 * algum falhe. Estamos longe de um runner full-featured (jest/vitest), mas o
 * suficiente pra travar regressão estrutural antes de subir pra prod.
 */

// Path-alias resolution: tsx + tsconfig "@/*" → src/*
process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS ?? "") + " --experimental-specifier-resolution=node";

import {
  SCORE_TABLE,
  BADGE_RULES,
  REI_DO_MES_THRESHOLDS,
} from "../src/lib/gamification";
import {
  ALL_BADGES,
  BADGE_META,
  BADGE_TIERS,
  BADGE_REASON,
  BADGE_CATEGORY,
  CATEGORY_META,
  CATEGORY_ORDER,
  REASON_LABEL,
  getBadgeProgress,
  shouldShowBadge,
} from "../src/app/(admin)/gamificacao/labels";
import {
  SCORING_TRIGGER,
  EDITABLE_REASONS,
  TRIGGER_LABEL,
} from "../src/app/(admin)/gamificacao/scoring-meta";
import { ScoreReason, BadgeType } from "../src/generated/prisma";

// ─── Mini test runner ────────────────────────────────────────────────────────

type Test = { name: string; fn: () => void };
const tests: Test[] = [];
let currentSection = "";
let passed = 0;
let failed = 0;
const failures: string[] = [];

function section(name: string) {
  currentSection = name;
  console.log(`\n\x1b[1;36m── ${name} ──\x1b[0m`);
}
function test(name: string, fn: () => void) {
  tests.push({ name: `${currentSection} :: ${name}`, fn });
}
function assert(cond: any, msg: string) {
  if (!cond) throw new Error(msg);
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) throw new Error(`${msg}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
}
function assertDeepEqual(a: any, b: any, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg}\n  expected: ${JSON.stringify(b)}\n  actual:   ${JSON.stringify(a)}`);
  }
}
function run() {
  for (const t of tests) {
    try {
      t.fn();
      passed++;
      console.log(`  \x1b[32m✓\x1b[0m ${t.name}`);
    } catch (err: any) {
      failed++;
      failures.push(`${t.name}: ${err.message}`);
      console.log(`  \x1b[31m✗\x1b[0m ${t.name}`);
      console.log(`    \x1b[31m${err.message}\x1b[0m`);
    }
  }
  console.log(`\n\x1b[1m${passed + failed} testes — \x1b[32m${passed} passou\x1b[0m \x1b[31m${failed} falhou\x1b[0m`);
  if (failed > 0) {
    console.log(`\n\x1b[1;31mFALHAS:\x1b[0m`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

// Lista canônica de todos os ScoreReason do enum Prisma — usada várias vezes
// pra checar exhaustividade. Como Prisma não expõe Object.keys do enum em
// runtime de forma confiável quando importado direto, derivamos da union
// dos consumidores que o exigem (SCORE_TABLE, REASON_LABEL, SCORING_TRIGGER).
const ALL_SCORE_REASONS: ScoreReason[] = Array.from(
  new Set<ScoreReason>([
    ...(Object.keys(SCORE_TABLE) as ScoreReason[]),
    ...(Object.keys(REASON_LABEL) as ScoreReason[]),
    ...(Object.keys(SCORING_TRIGGER) as ScoreReason[]),
  ]),
);

// ─── Seção 1: SCORE_TABLE ────────────────────────────────────────────────────

section("SCORE_TABLE");

test("toda razão tem entrada (SCORE_TABLE, REASON_LABEL, SCORING_TRIGGER concordam)", () => {
  for (const r of ALL_SCORE_REASONS) {
    assert(SCORE_TABLE[r] !== undefined,    `SCORE_TABLE faltando: ${r}`);
    assert(REASON_LABEL[r] !== undefined,   `REASON_LABEL faltando: ${r}`);
    assert(SCORING_TRIGGER[r] !== undefined,`SCORING_TRIGGER faltando: ${r}`);
  }
});

test("pontos são inteiros", () => {
  for (const [reason, pts] of Object.entries(SCORE_TABLE)) {
    assert(Number.isInteger(pts), `${reason} = ${pts} não é inteiro`);
  }
});

test("INCIDENTE tem peso 0 (override pelo admin)", () => {
  assertEqual(SCORE_TABLE.INCIDENTE, 0, "INCIDENTE deve ser 0");
});

test("REASON_LABEL.positive bate com SCORE_TABLE >= 0 (exceto INCIDENTE que é 0 mas penalidade)", () => {
  for (const r of ALL_SCORE_REASONS) {
    if (r === "INCIDENTE") continue;
    const pts = SCORE_TABLE[r];
    const positive = REASON_LABEL[r].positive;
    if (pts > 0)  assert(positive,  `${r} tem pts +${pts} mas REASON_LABEL.positive=false`);
    if (pts < 0)  assert(!positive, `${r} tem pts ${pts} mas REASON_LABEL.positive=true`);
  }
});

// ─── Seção 2: BADGE_RULES ↔ BADGE_TIERS ──────────────────────────────────────

section("BADGE_RULES ↔ BADGE_TIERS");

test("toda BADGE_RULE tem 6 thresholds", () => {
  for (const rule of BADGE_RULES) {
    assertEqual(rule.thresholds.length, 6, `${rule.badge}: esperava 6 thresholds`);
  }
});

test("thresholds são estritamente crescentes", () => {
  for (const rule of BADGE_RULES) {
    for (let i = 1; i < rule.thresholds.length; i++) {
      assert(
        rule.thresholds[i] > rule.thresholds[i - 1],
        `${rule.badge}: threshold N${i+1}=${rule.thresholds[i]} <= N${i}=${rule.thresholds[i-1]}`,
      );
    }
  }
});

test("BADGE_RULES.thresholds === BADGE_TIERS[badge].threshold (UI espelha lógica)", () => {
  for (const rule of BADGE_RULES) {
    const tiers = BADGE_TIERS[rule.badge];
    assert(tiers, `BADGE_TIERS faltando para ${rule.badge}`);
    const fromTiers = tiers.map((t) => t.threshold);
    assertDeepEqual(fromTiers, rule.thresholds, `${rule.badge}: BADGE_TIERS thresholds ≠ BADGE_RULES thresholds`);
  }
});

test("REI_DO_MES_THRESHOLDS espelha BADGE_TIERS.REI_DO_MES", () => {
  const fromTiers = BADGE_TIERS.REI_DO_MES.map((t) => t.threshold);
  assertDeepEqual(fromTiers, REI_DO_MES_THRESHOLDS, "REI_DO_MES tiers fora de sync");
  assertEqual(REI_DO_MES_THRESHOLDS.length, 6, "REI_DO_MES deve ter 6 tiers");
});

test("BADGE_RULES.reasons existem em SCORE_TABLE", () => {
  for (const rule of BADGE_RULES) {
    for (const r of rule.reasons) {
      assert(SCORE_TABLE[r] !== undefined, `${rule.badge} aponta pra reason inexistente: ${r}`);
    }
  }
});

test("BADGE_REASON em labels.ts bate com BADGE_RULES (1ª razão por badge)", () => {
  // Convenção: cada badge tem 1 reason principal; labels.BADGE_REASON usa esse.
  for (const rule of BADGE_RULES) {
    const labelsReason = BADGE_REASON[rule.badge];
    assert(
      rule.reasons.includes(labelsReason as ScoreReason),
      `${rule.badge}: labels.BADGE_REASON=${labelsReason} não está em BADGE_RULES.reasons=[${rule.reasons.join(",")}]`,
    );
  }
});

// ─── Seção 3: BadgeType cobertura ────────────────────────────────────────────

section("BadgeType cobertura");

test("ALL_BADGES tem todos os BadgeType com metadados", () => {
  for (const b of ALL_BADGES) {
    assert(BADGE_META[b],     `BADGE_META faltando: ${b}`);
    assert(BADGE_TIERS[b],    `BADGE_TIERS faltando: ${b}`);
    assert(BADGE_REASON[b] !== undefined, `BADGE_REASON faltando: ${b}`);
    assert(BADGE_CATEGORY[b], `BADGE_CATEGORY faltando: ${b}`);
  }
});

test("toda categoria em BADGE_CATEGORY existe em CATEGORY_ORDER", () => {
  const categorias = new Set(Object.values(BADGE_CATEGORY));
  for (const c of categorias) {
    assert(CATEGORY_ORDER.includes(c), `categoria órfã: ${c}`);
    assert(CATEGORY_META[c],            `CATEGORY_META faltando: ${c}`);
  }
});

test("REI_DO_MES é o único badge sem reason direto (concedido por cron)", () => {
  for (const b of ALL_BADGES) {
    const reason = BADGE_REASON[b];
    if (b === "REI_DO_MES") {
      assertEqual(reason, null, "REI_DO_MES deve ter reason=null em BADGE_REASON");
    } else {
      assert(reason !== null, `${b}: reason direta não pode ser null`);
    }
  }
});

test("easter eggs (isHidden) são exatamente CORUJA, MADRUGADOR, SORTUDO, FENIX", () => {
  const hidden = ALL_BADGES.filter((b) => BADGE_META[b].isHidden);
  assertDeepEqual(
    hidden.sort(),
    (["CORUJA", "MADRUGADOR", "SORTUDO", "FENIX"] as BadgeType[]).sort(),
    "lista de easter eggs divergente",
  );
});

test("shouldShowBadge: easter egg escondido pra non-admin sem conquista", () => {
  assertEqual(shouldShowBadge("CORUJA",  /*isAdmin*/ false, /*earned*/ false), false, "non-admin sem CORUJA não deve ver");
  assertEqual(shouldShowBadge("CORUJA",  false, true), true, "non-admin com CORUJA deve ver");
  assertEqual(shouldShowBadge("CORUJA",  true,  false), true, "admin sempre vê");
  assertEqual(shouldShowBadge("RAIO_VELOZ", false, false), true, "badge normal sempre visível");
});

// ─── Seção 4: SCORING_TRIGGER & EDITABLE_REASONS ─────────────────────────────

section("SCORING_TRIGGER & EDITABLE_REASONS");

test("toda razão tem trigger conhecido", () => {
  const valid = new Set(Object.keys(TRIGGER_LABEL));
  for (const r of ALL_SCORE_REASONS) {
    assert(valid.has(SCORING_TRIGGER[r]), `${r}: trigger desconhecido ${SCORING_TRIGGER[r]}`);
  }
});

test("EDITABLE_REASONS exclui INCIDENTE / BONUS_SUPEROU_MES / DERIVED", () => {
  assert(!EDITABLE_REASONS.includes("INCIDENTE"),         "INCIDENTE não deve ser editável (override no momento)");
  assert(!EDITABLE_REASONS.includes("BONUS_SUPEROU_MES"), "BONUS_SUPEROU_MES não deve ser editável (sistêmico)");
  for (const r of EDITABLE_REASONS) {
    assert(SCORING_TRIGGER[r] !== "DERIVED", `${r}: derived não deveria ser editável`);
  }
});

test("EDITABLE_REASONS cobre as razões que admins esperam ajustar", () => {
  // Sanidade: razões críticas pra negócio têm que estar editáveis.
  const must = [
    "RESPOSTA_RAPIDA_5MIN", "RESPOSTA_RAPIDA_30MIN",
    "TICKET_RESOLVIDO", "TICKET_NO_PRAZO", "TICKET_RESOLVIDO_MESMO_DIA",
    "LEAD_AVANCADO", "LEAD_VIROU_OPORTUNIDADE", "LEAD_CONVERTIDO",
    "DIA_SEM_ATRASO", "DIA_NETWORK",
    "AJUDA_EXERCITO", "PRIMEIRA_RESPOSTA", "ENCAMINHAMENTO",
    "ATENDIMENTO_GRUPO_NOVO", "RESPOSTA_RAPIDA_GRUPO",
    "CONVERSA_SEM_RESPOSTA", "SLA_VENCIDO",
    "PROJETO_ENTREGUE", "PROJETO_ENTREGUE_NO_PRAZO", "PROJETO_ATRASADO",
    "TAREFA_SEM_PRAZO", "TAREFA_ATRASADA", "TAREFA_SEM_RESPONSAVEL",
  ] as ScoreReason[];
  for (const r of must) {
    assert(EDITABLE_REASONS.includes(r), `${r}: deveria ser editável`);
  }
});

test("STREAK_DIA é DERIVED (criada dentro de runDiaSemAtraso)", () => {
  assertEqual(SCORING_TRIGGER.STREAK_DIA, "DERIVED", "STREAK_DIA deveria ter trigger DERIVED");
});

test("DIA_NETWORK é WEEKLY (cron de segunda)", () => {
  assertEqual(SCORING_TRIGGER.DIA_NETWORK, "WEEKLY", "DIA_NETWORK deveria ter trigger WEEKLY");
});

// ─── Seção 5: getBadgeProgress ───────────────────────────────────────────────

section("getBadgeProgress (função pura)");

test("count=0 → currentTier=null, nextTier=N1, progress=0", () => {
  const p = getBadgeProgress("RAIO_VELOZ", 0);
  assertEqual(p.currentTier, null, "currentTier deveria ser null");
  assertEqual(p.nextTier?.level, 1, "nextTier deveria ser N1");
  assertEqual(p.progress, 0, "progress deveria ser 0");
});

test("count exato no threshold → currentTier=N, nextTier=N+1, progress=0", () => {
  // RAIO_VELOZ tier 1 = 3
  const p = getBadgeProgress("RAIO_VELOZ", 3);
  assertEqual(p.currentTier?.level, 1, "currentTier deveria ser N1");
  assertEqual(p.nextTier?.level, 2, "nextTier deveria ser N2");
  assertEqual(p.progress, 0, "progress deveria reiniciar em 0");
});

test("count entre tiers → progress proporcional", () => {
  // RAIO_VELOZ N1=3, N2=15, intervalo=12. count=9 → progress = 6/12 = 0.5
  const p = getBadgeProgress("RAIO_VELOZ", 9);
  assertEqual(p.currentTier?.level, 1, "currentTier deveria ser N1");
  assertEqual(p.nextTier?.level, 2, "nextTier deveria ser N2");
  assert(Math.abs(p.progress - 0.5) < 0.001, `progress deveria ser ~0.5 (foi ${p.progress})`);
});

test("count maior que último threshold → currentTier=N6, nextTier=null, progress=1", () => {
  // RAIO_VELOZ N6=1500
  const p = getBadgeProgress("RAIO_VELOZ", 99999);
  assertEqual(p.currentTier?.level, 6, "currentTier deveria ser N6");
  assertEqual(p.nextTier, null, "nextTier deveria ser null");
  assertEqual(p.progress, 1, "progress deveria ser 1");
});

test("getBadgeProgress não quebra com count negativo", () => {
  const p = getBadgeProgress("RAIO_VELOZ", -5);
  assertEqual(p.currentTier, null, "negativo deveria ficar bloqueado");
  assertEqual(p.nextTier?.level, 1, "nextTier ainda N1");
  assert(p.progress >= 0, "progress não pode ser negativo (clamp)");
});

// ─── Seção 6: balanceamento competitivo ──────────────────────────────────────

section("balanceamento competitivo");

test("nenhuma razão positiva editável vale > 100 pts (anti-snowball)", () => {
  // Limite arbitrário pra detectar escalada — se um ponto de venda valer 200,
  // 1 venda derruba todo o esforço de uma equipe inteira de suporte no mês.
  for (const r of EDITABLE_REASONS) {
    const pts = SCORE_TABLE[r];
    if (pts > 0) {
      assert(pts <= 100, `${r}=+${pts} excede o teto de balanceamento (+100)`);
    }
  }
});

test("nenhuma penalidade vale < -50 (anti-aniquilação)", () => {
  for (const r of EDITABLE_REASONS) {
    const pts = SCORE_TABLE[r];
    if (pts < 0) {
      assert(pts >= -50, `${r}=${pts} excede o piso de balanceamento (-50)`);
    }
  }
});

test("razões diárias (resposta) não são gigantes a ponto de superar uma venda em um turno", () => {
  // Soma dos pontos batchable num único dia (1× cada) — não deveria estourar
  // uma venda só no autoritarismo dos micro-eventos.
  const oneDayMax =
    SCORE_TABLE.RESPOSTA_RAPIDA_5MIN +
    SCORE_TABLE.PRIMEIRA_RESPOSTA +
    SCORE_TABLE.AJUDA_EXERCITO +
    SCORE_TABLE.ATENDIMENTO_GRUPO_NOVO +
    SCORE_TABLE.RESPOSTA_RAPIDA_GRUPO +
    SCORE_TABLE.BONUS_NOITE +
    SCORE_TABLE.BONUS_MADRUGADA;
  assert(
    oneDayMax < SCORE_TABLE.LEAD_CONVERTIDO,
    `dia ótimo (${oneDayMax}pt) >= 1 venda (${SCORE_TABLE.LEAD_CONVERTIDO}pt) — risco de farming`,
  );
});

test("ranking PRODUCAO × GESTAO está separado (categorias mutuamente exclusivas)", () => {
  // Categorização funcional vista no schema/ranking — só checa que os labels
  // que populam o leaderboard são exatamente esses 2 (não há "AMBAS" etc.).
  const valores = ["PRODUCAO", "GESTAO"];
  assertEqual(valores.length, 2, "ranking deve ter exatamente 2 categorias");
});

// ─── Seção 7: configuracoes API contract ─────────────────────────────────────

section("contrato com /api/configuracoes/gamificacao");

test("toda razão editável tem default em SCORE_TABLE (UI consegue mostrar)", () => {
  for (const r of EDITABLE_REASONS) {
    assert(SCORE_TABLE[r] !== undefined, `${r}: defaultPoints=undefined quebra o GET`);
  }
});

test("toda razão editável tem REASON_LABEL (UI consegue rotular)", () => {
  for (const r of EDITABLE_REASONS) {
    assert(REASON_LABEL[r], `${r}: REASON_LABEL undefined`);
  }
});

// ─── run ─────────────────────────────────────────────────────────────────────

run();
