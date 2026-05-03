/**
 * whatsapp-guard.ts
 *
 * Defesas anti-banimento aplicadas ANTES de cada envio de mensagem
 * via Evolution API:
 *
 * 1. Throttling + jitter por instância — serializa envios, espalha
 *    250-450ms entre mensagens. Quebra o pattern "rajada" que o
 *    WhatsApp detecta.
 *
 * 2. Limite diário por instância — bloqueia depois de N mensagens/dia.
 *    Limite cresce conforme a instância "amadurece" (30 dias):
 *      - novo: 800/dia
 *      - estabelecido: 1500/dia
 *    Override via env (WHATSAPP_DAILY_LIMIT_*).
 *
 * 3. Validação de contato — CLIENT só pode enviar pra telefone que
 *    já mandou INBOUND. ADMIN/SUPER_ADMIN podem mandar cold messages
 *    (necessário pra primeira abordagem em prospect).
 */

import { prisma } from "./prisma";

const NEW_THRESHOLD_DAYS = parseInt(
  process.env.WHATSAPP_NEW_INSTANCE_DAYS ?? "30",
  10,
);
const LIMIT_NEW = parseInt(
  process.env.WHATSAPP_DAILY_LIMIT_NEW ?? "800",
  10,
);
const LIMIT_ESTABLISHED = parseInt(
  process.env.WHATSAPP_DAILY_LIMIT_ESTABLISHED ?? "1500",
  10,
);
const THROTTLE_BASE_MS = parseInt(
  process.env.WHATSAPP_THROTTLE_BASE_MS ?? "250",
  10,
);
const THROTTLE_JITTER_MS = parseInt(
  process.env.WHATSAPP_THROTTLE_JITTER_MS ?? "200",
  10,
);

// ─── Throttling ──────────────────────────────────────────────────────────────
// Serializa por instanceId. Cada chamada espera a anterior terminar +
// pausa aleatória antes de retornar o slot. Em ambientes serverless o map é
// por-container (não distribuído), mas ainda ajuda no caso comum (mesma
// instância recebendo múltiplas requests no mesmo container).

const sendQueues = new Map<string, Promise<void>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function acquireSendSlot(instanceId: string): Promise<void> {
  const prev = sendQueues.get(instanceId) ?? Promise.resolve();
  const jitter = Math.floor(Math.random() * THROTTLE_JITTER_MS);
  const slot = prev.then(() => sleep(THROTTLE_BASE_MS + jitter));
  sendQueues.set(instanceId, slot);
  await slot;
  // Cleanup oportunista — se a slot atual já terminou, libera o map
  if (sendQueues.get(instanceId) === slot) {
    // Guarda só a última (chained), evita memory leak
    setTimeout(() => {
      if (sendQueues.get(instanceId) === slot) {
        sendQueues.delete(instanceId);
      }
    }, 1000);
  }
}

// ─── Limite diário ───────────────────────────────────────────────────────────

export type QuotaResult =
  | { ok: true;  count: number; limit: number }
  | { ok: false; count: number; limit: number; reason: string };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function checkAndConsumeDailyQuota(
  instanceId: string,
  instanceCreatedAt: Date,
): Promise<QuotaResult> {
  const day = todayKey();
  const ageMs = Date.now() - instanceCreatedAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const limit = ageDays < NEW_THRESHOLD_DAYS ? LIMIT_NEW : LIMIT_ESTABLISHED;

  // Increment atômico via upsert. count refletido vem da operação.
  const row = await prisma.whatsappQuota.upsert({
    where:  { instanceId_day: { instanceId, day } },
    create: { instanceId, day, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });

  if (row.count > limit) {
    // Estouro: já incrementamos, mas a mensagem não vai ser enviada.
    // Decrementa pra não consumir falsamente o saldo.
    await prisma.whatsappQuota.update({
      where: { instanceId_day: { instanceId, day } },
      data:  { count: { decrement: 1 } },
    }).catch(() => {});
    return {
      ok: false,
      count: limit, // exibe o limite, não o N+1
      limit,
      reason: `Limite diário atingido (${limit} mensagens). Aguarde até amanhã para proteger o número.`,
    };
  }

  return { ok: true, count: row.count, limit };
}

// ─── Validação de contato (cold message) ─────────────────────────────────────
// Regra: SUPER_ADMIN/ADMIN podem mandar cold message. CLIENT precisa de uma
// INBOUND prévia da empresa pra esse phone. Grupos (@g.us) e @lid sempre
// permitidos (não há "cold" pra grupo do qual você já participa).

export async function isPhoneKnown(
  companyId: string,
  phone: string,
): Promise<boolean> {
  if (phone.includes("@g.us") || phone.includes("@lid")) return true;
  const inbound = await prisma.message.findFirst({
    where:  { companyId, phone, direction: "INBOUND" },
    select: { id: true },
  });
  return !!inbound;
}

// ─── Entry point único ───────────────────────────────────────────────────────

export interface SendGuardOk {
  ok: true;
  quotaUsed: number;
  quotaLimit: number;
}

export interface SendGuardFail {
  ok: false;
  status: number;
  error: string;
}

export interface SendGuardInput {
  instanceId: string;
  instanceCreatedAt: Date;
  companyId: string;
  phone: string;
  userRole: string;
}

/**
 * Roda as 3 defesas em ordem (cold check → quota → throttle). Retorna ok
 * quando pode enviar; caller continua com a chamada à Evolution API.
 *
 * Aborto cedo evita consumir quota e throttle slot quando a mensagem ia
 * ser bloqueada por validação.
 */
export async function enforceSendGuards(
  input: SendGuardInput,
): Promise<SendGuardOk | SendGuardFail> {
  const { instanceId, instanceCreatedAt, companyId, phone, userRole } = input;

  // 1. Cold message — CLIENT exige histórico INBOUND
  if (userRole === "CLIENT") {
    const known = await isPhoneKnown(companyId, phone);
    if (!known) {
      return {
        ok: false,
        status: 403,
        error:
          "Sem histórico de mensagens recebidas deste contato. Apenas administradores podem iniciar conversas com novos contatos.",
      };
    }
  }

  // 2. Limite diário (consome 1)
  const quota = await checkAndConsumeDailyQuota(instanceId, instanceCreatedAt);
  if (!quota.ok) {
    return { ok: false, status: 429, error: quota.reason };
  }

  // 3. Throttling (espera o slot)
  await acquireSendSlot(instanceId);

  return { ok: true, quotaUsed: quota.count, quotaLimit: quota.limit };
}

/**
 * Devolve quota consumida ao detectar falha 5xx/4xx no envio. Mantém
 * contagem honesta — só conta sucessos.
 */
export async function releaseQuota(instanceId: string): Promise<void> {
  await prisma.whatsappQuota.update({
    where: { instanceId_day: { instanceId, day: todayKey() } },
    data:  { count: { decrement: 1 } },
  }).catch(() => {});
}
