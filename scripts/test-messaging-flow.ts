/**
 * Simulador do fluxo de mensagens — sem DB.
 *
 * Recebe "webhooks da Evolution" fictícios (payload no formato real:
 * messages.upsert com remoteJid, fromMe, conversation, pushName) e roda
 * pela MESMA função pura `decideConversationUpdate` que o webhook em produção
 * usa. Mantém estado da Conversation in-memory.
 *
 * Validamos:
 *   - Atendimento individual (1-on-1)
 *   - Atendimento em grupo (@g.us)
 *   - Mensagem terminal pós-CLOSED (não reabre)
 *   - Reabertura com novo assunto
 *   - Agendamento de retorno + follow-up
 *
 * Executar:
 *   npx tsx scripts/test-messaging-flow.ts
 */

import {
  decideConversationUpdate,
  isTerminalMessage,
  type ExistingConversationSnapshot,
} from "../src/lib/whatsapp";
import { businessMinutesBetweenWithConfig } from "../src/lib/business-hours";
import type { ConversationStatus, MessageDir } from "../src/generated/prisma";

const DEFAULT_HOURS = Array.from({ length: 7 }, (_, d) => ({
  dayOfWeek: d, isOpen: d >= 1 && d <= 5,
  openTime: "09:00", closeTime: "18:00", intervals: [],
}));

// ─── Estado in-memory (substitui Prisma) ─────────────────────────────────────

type Conversation = ExistingConversationSnapshot & {
  phone: string;
  isGroup: boolean;
  unreadCount: number;
  firstResponseAt: Date | null;
  lastMessageBody: string | null;
  lastMessageDirection: MessageDir | null;
  returnNote: string | null;
};

const store = new Map<string, Conversation>();
const activities: Array<{ phone: string; type: string; body: string; at: Date }> = [];

// ─── Payload Evolution → ingestão ────────────────────────────────────────────

type EvolutionWebhook = {
  event: "messages.upsert";
  data: {
    key: { remoteJid: string; fromMe: boolean; id: string };
    message: { conversation?: string; extendedTextMessage?: { text: string } };
    messageTimestamp: number;
    pushName?: string;
  };
};

function makeWebhook(remoteJid: string, fromMe: boolean, text: string, pushName?: string): EvolutionWebhook {
  return {
    event: "messages.upsert",
    data: {
      key: { remoteJid, fromMe, id: `MSG_${Math.random().toString(36).slice(2, 10)}` },
      message: { conversation: text },
      messageTimestamp: Math.floor(Date.now() / 1000),
      pushName,
    },
  };
}

/** Espelha o caminho do webhook real: extrai dados do payload e chama upsert. */
function ingestEvolution(payload: EvolutionWebhook): { conversation: Conversation; logs: string[] } {
  const { remoteJid, fromMe } = payload.data.key;
  const direction: MessageDir = fromMe ? "OUTBOUND" : "INBOUND";
  const body = payload.data.message.conversation
    ?? payload.data.message.extendedTextMessage?.text
    ?? "";
  const now = new Date(payload.data.messageTimestamp * 1000);

  const existing = store.get(remoteJid) ?? null;
  const decision = decideConversationUpdate({
    direction, body, now,
    existing: existing
      ? { status: existing.status, scheduledReturnAt: existing.scheduledReturnAt,
          assigneeId: existing.assigneeId, closedAt: existing.closedAt }
      : null,
  });

  const isGroup = remoteJid.includes("@g.us") || remoteJid.includes("@lid");
  const conv: Conversation = existing
    ? { ...existing }
    : {
        phone: remoteJid, isGroup,
        status: decision.newStatus,
        scheduledReturnAt: null, assigneeId: null, closedAt: null,
        unreadCount: 0, firstResponseAt: null,
        lastMessageBody: null, lastMessageDirection: null,
        returnNote: null,
      };

  if (decision.statusChanged) conv.status = decision.newStatus;
  conv.lastMessageBody = body.slice(0, 200);
  conv.lastMessageDirection = direction;
  if (!decision.preserveClosedAt) conv.closedAt = null;
  conv.unreadCount = direction === "INBOUND" ? conv.unreadCount + 1 : 0;
  if (direction === "OUTBOUND" && !conv.firstResponseAt) conv.firstResponseAt = now;
  if (decision.closingScheduled) { conv.scheduledReturnAt = null; conv.returnNote = null; }

  store.set(remoteJid, conv);

  const logs: string[] = [];
  if (decision.activities.reopened) {
    activities.push({ phone: remoteJid, type: "CONVERSATION_REOPENED", body: "Cliente respondeu — conversa reaberta", at: now });
    logs.push("📥 Activity logada: CONVERSATION_REOPENED");
  }
  if (decision.activities.terminalReply) {
    activities.push({ phone: remoteJid, type: "STATUS_CHANGED", body: `Cliente respondeu pós-finalização (${body.slice(0, 30)}) — atendimento mantido fechado`, at: now });
    logs.push("📥 Activity logada: terminal reply (CLOSED preservado)");
  }
  if (decision.activities.scheduledClosed === "ontime") {
    logs.push("⭐ RETORNO_ANTECIPADO seria pontuado pra assignee");
  }
  return { conversation: conv, logs };
}

// ─── Helpers de assert ───────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failureMsgs: string[] = [];

function expect<T>(actual: T, expected: T, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`     \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed++;
    const msg = `${label} — esperado ${JSON.stringify(expected)}, obtido ${JSON.stringify(actual)}`;
    failureMsgs.push(msg);
    console.log(`     \x1b[31m✗\x1b[0m ${msg}`);
  }
}

function step(title: string, fn: () => void) {
  console.log(`\n  \x1b[1;36m${title}\x1b[0m`);
  fn();
}

function statusBadge(s: ConversationStatus): string {
  const map: Record<string, string> = {
    OPEN: "🆕 OPEN", PENDING: "🔴 PENDING", IN_PROGRESS: "🟡 IN_PROGRESS",
    WAITING_CUSTOMER: "🔵 WAITING_CUSTOMER", SCHEDULED: "🟣 SCHEDULED", CLOSED: "⚪ CLOSED",
  };
  return map[s] ?? s;
}

function showState(remoteJid: string) {
  const c = store.get(remoteJid);
  if (!c) { console.log(`     [sem conversa]`); return; }
  console.log(`     → status=${statusBadge(c.status)}  unread=${c.unreadCount}  closedAt=${c.closedAt ? c.closedAt.toISOString() : "—"}  scheduled=${c.scheduledReturnAt ? c.scheduledReturnAt.toISOString() : "—"}`);
}

// ─── Cenário A: atendimento individual (1-on-1) ─────────────────────────────

function scenarioIndividual() {
  console.log(`\n\x1b[1;33m━━━ CENÁRIO A: Atendimento individual (cliente João) ━━━\x1b[0m`);
  const jid = "5547999887766@s.whatsapp.net";

  step("A1. João manda primeira mensagem", () => {
    const { conversation, logs } = ingestEvolution(makeWebhook(jid, false, "Oi, boa tarde, preciso de ajuda com meu pedido", "João Silva"));
    logs.forEach((l) => console.log(`     ${l}`));
    showState(jid);
    expect(conversation.status, "OPEN", "Status = OPEN (precisa resposta)");
    expect(conversation.isGroup, false, "isGroup = false");
    expect(conversation.unreadCount, 1, "unreadCount = 1");
  });

  step("A2. Atendente Maria responde", () => {
    const { conversation } = ingestEvolution(makeWebhook(jid, true, "Olá João, posso ajudar! Qual o número do pedido?"));
    showState(jid);
    expect(conversation.status, "WAITING_CUSTOMER", "Status = WAITING_CUSTOMER (esperando cliente)");
    expect(conversation.unreadCount, 0, "unreadCount zerado");
    expect(conversation.firstResponseAt !== null, true, "firstResponseAt registrado");
  });

  step("A3. João responde com a info", () => {
    const { conversation } = ingestEvolution(makeWebhook(jid, false, "É o pedido 12345, está atrasado"));
    showState(jid);
    expect(conversation.status, "OPEN", "Volta pra OPEN — bola está com a gente");
    expect(conversation.unreadCount, 1, "unreadCount = 1 (Maria precisa ver)");
  });

  step("A4. Maria finaliza o atendimento", () => {
    const c = store.get(jid)!;
    c.status = "CLOSED";
    c.closedAt = new Date();
    showState(jid);
    expect(c.status, "CLOSED", "CLOSED registrado");
  });

  step("A5. João manda 'obrigado!' (pós-finalização)", () => {
    const { conversation, logs } = ingestEvolution(makeWebhook(jid, false, "obrigado pela ajuda!"));
    logs.forEach((l) => console.log(`     ${l}`));
    showState(jid);
    expect(conversation.status, "CLOSED", "CLOSED MANTIDO — não exige novo Finalizar");
    expect(conversation.closedAt !== null, true, "closedAt preservado");
    expect(conversation.unreadCount >= 1, true, "unreadCount sobe (Maria vê o agradecimento)");
  });

  step("A6. João manda só '👍'", () => {
    const { conversation } = ingestEvolution(makeWebhook(jid, false, "👍"));
    showState(jid);
    expect(conversation.status, "CLOSED", "Emoji isolado: também não reabre");
  });

  step("A7. João traz NOVO assunto", () => {
    const { conversation, logs } = ingestEvolution(makeWebhook(jid, false, "Surgiu outro problema com o pagamento"));
    logs.forEach((l) => console.log(`     ${l}`));
    showState(jid);
    expect(conversation.status, "OPEN", "REABRE — novo assunto exige atendimento");
    expect(conversation.closedAt, null, "closedAt limpo");
    expect(activities.some((a) => a.type === "CONVERSATION_REOPENED" && a.phone === jid), true, "Activity CONVERSATION_REOPENED logada");
  });

  step("A8. Maria responde e agenda retorno pra dois dias", () => {
    ingestEvolution(makeWebhook(jid, true, "Vou verificar e te retorno daqui 2 dias"));
    const c = store.get(jid)!;
    c.status = "SCHEDULED";
    c.scheduledReturnAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    c.returnNote = "verificar pagamento e ligar";
    showState(jid);
    expect(c.status, "SCHEDULED", "Status = SCHEDULED");
  });

  step("A9. Maria manda follow-up enquanto SCHEDULED", () => {
    const { conversation } = ingestEvolution(makeWebhook(jid, true, "Só lembrando: te ligo na quarta às 14h"));
    showState(jid);
    expect(conversation.status, "SCHEDULED", "SCHEDULED resiste ao OUTBOUND");
    expect(conversation.scheduledReturnAt !== null, true, "scheduledReturnAt preservado");
  });

  step("A10. João responde antes do prazo", () => {
    const { conversation, logs } = ingestEvolution(makeWebhook(jid, false, "Pode ser, fico no aguardo"));
    logs.forEach((l) => console.log(`     ${l}`));
    showState(jid);
    expect(conversation.status, "OPEN", "Volta pra OPEN — cliente engajou cedo");
    expect(conversation.scheduledReturnAt, null, "Agendamento limpo (sai do calendário)");
    expect(conversation.returnNote, null, "returnNote limpo");
  });
}

// ─── Cenário B: atendimento em grupo (@g.us) ────────────────────────────────

function scenarioGroup() {
  console.log(`\n\x1b[1;33m━━━ CENÁRIO B: Atendimento em grupo (Time Cliente XYZ) ━━━\x1b[0m`);
  const groupJid = "120363045678901234@g.us";

  step("B1. Membro do grupo manda mensagem", () => {
    const { conversation } = ingestEvolution(makeWebhook(groupJid, false, "Pessoal, alguém pode olhar o relatório?", "Pedro (Cliente XYZ)"));
    showState(groupJid);
    expect(conversation.isGroup, true, "Detectado como grupo (@g.us)");
    expect(conversation.status, "OPEN", "Grupo entra como OPEN");
  });

  step("B2. Atendente do nosso lado responde", () => {
    const { conversation } = ingestEvolution(makeWebhook(groupJid, true, "Oi Pedro, vou verificar agora"));
    showState(groupJid);
    expect(conversation.status, "WAITING_CUSTOMER", "WAITING_CUSTOMER após resposta");
  });

  step("B3. Outro membro manda 'valeu' rapidamente", () => {
    const c = store.get(groupJid)!;
    c.status = "CLOSED";
    c.closedAt = new Date();
    const { conversation, logs } = ingestEvolution(makeWebhook(groupJid, false, "valeu", "Ana (Cliente XYZ)"));
    logs.forEach((l) => console.log(`     ${l}`));
    showState(groupJid);
    expect(conversation.status, "CLOSED", "Em grupo, terminal também não reabre");
  });

  step("B4. Membro pergunta de novo (novo assunto)", () => {
    const { conversation } = ingestEvolution(makeWebhook(groupJid, false, "Pessoal, e o relatório de novembro? não chegou", "Pedro (Cliente XYZ)"));
    showState(groupJid);
    expect(conversation.status, "OPEN", "Reabre — novo assunto");
  });
}

// ─── Cenário C: limites do detector terminal ────────────────────────────────

function scenarioTerminalEdgeCases() {
  console.log(`\n\x1b[1;33m━━━ CENÁRIO C: Edge cases do detector terminal ━━━\x1b[0m`);
  const cases: [string, boolean, string][] = [
    ["obrigado", true, "palavra simples"],
    ["Obrigado!!!", true, "com pontuação"],
    ["valeu mesmo", true, "duas palavras whitelist"],
    ["👍", true, "emoji só"],
    ["🙏❤️", true, "emojis combinados"],
    ["fechou top", true, "duas terminais"],
    ["valeu, mas tenho mais uma duvida", false, "valeu + texto longo NÃO é terminal"],
    ["preciso de ajuda urgente", false, "pedido novo"],
    ["ok, vou pensar e te respondo amanha", false, "ok + texto não-whitelist"],
    ["", false, "vazio"],
    ["muito obrigado mesmo viu", true, "fillers + terminal"],
    ["obrigado pela ajuda", true, "obrigado + filler — caso comum"],
    ["valeu cara", true, "terminal + filler curto"],
    ["bom dia, obrigado", false, "saudação invalida (novo contato)"],
    ["obrigado, mas tenho outra duvida", false, "tem palavra de intenção"],
    ["agradeço", true, "palavra unica do whitelist"],
  ];
  for (const [body, expected, label] of cases) {
    const got = isTerminalMessage(body);
    expect(got, expected, `${JSON.stringify(body).padEnd(45)} → ${label}`);
  }
}

// ─── Cenário D: IN_PROGRESS — atendente pegou mas não respondeu ─────────────

function scenarioInProgress() {
  console.log(`\n\x1b[1;33m━━━ CENÁRIO D: Em atendimento (atendente "Pegou") ━━━\x1b[0m`);
  const jid = "5511988776655@s.whatsapp.net";

  step("D1. Cliente Lucia manda mensagem", () => {
    const { conversation } = ingestEvolution(makeWebhook(jid, false, "Boa tarde, vocês entregam em SP capital?", "Lucia"));
    showState(jid);
    expect(conversation.status, "OPEN", "OPEN — bola conosco, ninguém pegou");
  });

  step("D2. Atendente Carlos clica 'Pegar' (action=take)", () => {
    // Simula a rota PATCH /api/conversations/[id] action=take
    const c = store.get(jid)!;
    c.status = "IN_PROGRESS";
    c.assigneeId = "user_carlos";
    showState(jid);
    expect(c.status, "IN_PROGRESS", "IN_PROGRESS — Carlos está atendendo, ainda não respondeu");
    expect(c.assigneeId, "user_carlos", "assigneeId registrado");
  });

  step("D3. Carlos responde", () => {
    const { conversation } = ingestEvolution(makeWebhook(jid, true, "Olá Lucia, sim entregamos! Qual o CEP?"));
    showState(jid);
    expect(conversation.status, "WAITING_CUSTOMER", "Vai pra WAITING_CUSTOMER ao responder");
  });

  step("D4. Cliente responde", () => {
    const { conversation } = ingestEvolution(makeWebhook(jid, false, "01310-100"));
    showState(jid);
    expect(conversation.status, "OPEN", "OPEN — bola volta pro Carlos");
  });
}

// ─── Cenário E: PENDING — SLA cron promove ───────────────────────────────────
//
// Usa `businessMinutesBetweenWithConfig` (mesma função do cron real em
// /api/cron/sla) — assim o simulador valida tanto a regra de promoção quanto
// o cálculo de minutos úteis.

function scenarioPending() {
  console.log(`\n\x1b[1;33m━━━ CENÁRIO E: Sem atendimento (PENDING via SLA cron) ━━━\x1b[0m`);
  const SLA_MIN = 15;

  step("E1. Cliente Rafael manda mensagem 14h05 (terça, em horário útil)", () => {
    const jid = "5521977665544@s.whatsapp.net";
    const dt = new Date("2026-05-12T17:05:00Z"); // 14:05 BRT
    const wh = makeWebhook(jid, false, "Preciso de orçamento urgente", "Rafael");
    wh.data.messageTimestamp = Math.floor(dt.getTime() / 1000);
    const { conversation } = ingestEvolution(wh);
    showState(jid);
    expect(conversation.status, "OPEN", "OPEN — recém-chegou");
  });

  step("E2. Cron roda 14h25 — 20min úteis depois → promove pra PENDING", () => {
    const jid = "5521977665544@s.whatsapp.net";
    const sentAt = new Date("2026-05-12T17:05:00Z"); // 14:05 BRT
    const cronAt = new Date("2026-05-12T17:25:00Z"); // 14:25 BRT
    const elapsed = ((a: Date, b: Date) => businessMinutesBetweenWithConfig(a, b, DEFAULT_HOURS))(sentAt, cronAt);
    const wouldPromote = elapsed >= SLA_MIN;
    console.log(`     minutos úteis decorridos = ${elapsed}  (SLA = ${SLA_MIN}min)`);
    if (wouldPromote) {
      const c = store.get(jid)!;
      c.status = "PENDING";
      activities.push({ phone: jid, type: "STATUS_CHANGED", body: "Conversa marcada como SEM ATENDIMENTO (SLA estourado)", at: cronAt });
      console.log(`     📥 Activity: SLA estourado → PENDING`);
    }
    showState(jid);
    expect(wouldPromote, true, "Cron promove pra PENDING após 15+ min úteis");
    expect(store.get(jid)!.status, "PENDING", "Status visível como 🔴 'Sem atendimento' (pulsa em vermelho)");
  });

  step("E3. Mensagem que chega 18h05 (FORA do expediente) NÃO estoura SLA durante a noite", () => {
    const otherJid = "5521900000000@s.whatsapp.net";
    const sentAt = new Date("2026-05-12T21:05:00Z"); // 18:05 BRT
    const wh = makeWebhook(otherJid, false, "Oi, queria saber se atendem", "Outro Cliente");
    wh.data.messageTimestamp = Math.floor(sentAt.getTime() / 1000);
    ingestEvolution(wh);
    const cronAt = new Date("2026-05-13T01:00:00Z"); // 22h BRT
    const elapsed = ((a: Date, b: Date) => businessMinutesBetweenWithConfig(a, b, DEFAULT_HOURS))(sentAt, cronAt);
    console.log(`     minutos úteis entre 18h05 e 22h = ${elapsed} (esperado 0)`);
    expect(elapsed, 0, "Cron NÃO conta minutos fora do expediente");
    expect(store.get(otherJid)!.status, "OPEN", "Mantém OPEN durante a noite — não vira PENDING");
  });

  step("E4. Cron roda 9h15 do dia seguinte → SLA finalmente estoura", () => {
    const sentAt = new Date("2026-05-12T21:05:00Z"); // 18:05 BRT terça
    const cronAt = new Date("2026-05-13T12:15:00Z"); // 9:15 BRT quarta
    const elapsed = ((a: Date, b: Date) => businessMinutesBetweenWithConfig(a, b, DEFAULT_HOURS))(sentAt, cronAt);
    console.log(`     minutos úteis acumulados = ${elapsed}`);
    expect(elapsed >= SLA_MIN, true, "Após reabrir o expediente, contador acumula e cron promove");
  });
}

// ─── Tabela final: pergunta do usuário → status ─────────────────────────────

function showStatusGuide() {
  console.log(`\n\x1b[1;33m━━━ Guia: o que cada status significa pra equipe ━━━\x1b[0m`);
  const rows: [string, string, string][] = [
    ["Cliente chamou e ninguém pegou ainda", "🆕 OPEN", "\"Aberta\" (cyan) — alguém precisa pegar"],
    ["Atendente pegou mas ainda não respondeu", "🟡 IN_PROGRESS", "\"Em atendimento\" (amarelo) — em curso"],
    ["A gente respondeu, esperando cliente", "🔵 WAITING_CUSTOMER", "\"Aguardando cliente\" (azul) — bola com ele"],
    ["Cliente está aguardando retorno marcado", "🟣 SCHEDULED", "\"Aguardando retorno\" (roxo) — calendário"],
    ["Cliente chamou e SLA estourou (sem resposta)", "🔴 PENDING", "\"Sem atendimento\" (vermelho pulsa) — URGENTE"],
    ["Atendimento finalizado", "⚪ CLOSED", "\"Finalizada\" (cinza) — \"obrigado\" não reabre"],
  ];
  console.log("");
  for (const [pergunta, status, ui] of rows) {
    console.log(`  ${pergunta.padEnd(48)} ${status.padEnd(20)} ${ui}`);
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

scenarioIndividual();
scenarioGroup();
scenarioInProgress();
scenarioPending();
scenarioTerminalEdgeCases();
showStatusGuide();

console.log(`\n\x1b[1m${passed} passou\x1b[0m  \x1b[31m${failed} falhou\x1b[0m`);

if (failed === 0) {
  console.log(`\n\x1b[32m✅ Todos os cenários passaram. Os 6 status do atendimento são reais e funcionais.\x1b[0m`);
} else {
  console.log(`\n\x1b[31mFalhas:\x1b[0m`);
  failureMsgs.forEach((m) => console.log(`  - ${m}`));
  process.exit(1);
}
