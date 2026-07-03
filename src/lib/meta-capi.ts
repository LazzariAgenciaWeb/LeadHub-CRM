/**
 * Meta Conversions API (CAPI) — conversões offline do CRM.
 *
 * Quando um lead entra numa etapa marcada como GANHO (PipelineStageConfig.outcome),
 * mandamos um evento server-to-server pro Pixel do Meta pra otimizar campanhas por
 * venda real. Cada empresa-cliente configura o próprio Pixel + token CAPI em
 * MetaConversionConfig (token cifrado em AES-256-GCM).
 *
 * Docs: https://developers.facebook.com/docs/marketing-api/conversions-api
 * O match com quem clicou no anúncio é feito pelos dados do cliente hasheados
 * (email/telefone SHA-256). Sem fbc/fbclid o match é mais fraco — captura de
 * fbclid nos tracking links fica pra Fase 2.
 */
import { createHash } from "crypto";
import { prisma } from "./prisma";
import { decryptSecret } from "./crypto";

const GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

// ── Normalização + hash (exigência do Meta: minúsculo, sem espaços, SHA-256) ──

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** email → trim + lowercase → SHA-256. Retorna null se vazio/ inválido. */
function hashEmail(email?: string | null): string | null {
  if (!email) return null;
  const norm = email.trim().toLowerCase();
  if (!norm || !norm.includes("@")) return null;
  return sha256(norm);
}

/**
 * telefone → só dígitos, com código do país. Números do LeadHub já vêm como
 * "55…" (WhatsApp). Se vier sem DDI e tiver cara de número BR (10-11 dígitos),
 * prefixa 55. SHA-256 no final.
 */
function hashPhone(phone?: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
    digits = "55" + digits;
  }
  return sha256(digits);
}

/** nome próprio → trim + lowercase → SHA-256. */
function hashName(part?: string | null): string | null {
  if (!part) return null;
  const norm = part.trim().toLowerCase();
  if (!norm) return null;
  return sha256(norm);
}

type LeadLike = {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  value?: number | null;
  // Sinais de atribuição do Meta (Fase 2) — sobem PUROS, não hasheados.
  fbc?: string | null;
  fbp?: string | null;
  eventSourceUrl?: string | null;
  clientIp?: string | null;
  clientUserAgent?: string | null;
};

/**
 * Monta o bloco user_data. Dados pessoais (email/telefone/nome/cidade) vão
 * hasheados em SHA-256; fbc/fbp/ip/user-agent vão puros (exigência do Meta).
 * Quanto mais campos, melhor o match com quem clicou no anúncio.
 */
function buildUserData(lead: LeadLike): Record<string, unknown> {
  const ud: Record<string, unknown> = {};
  const em = hashEmail(lead.email);
  const ph = hashPhone(lead.phone);
  if (em) ud.em = [em];
  if (ph) ud.ph = [ph];

  if (lead.name) {
    const parts = lead.name.trim().split(/\s+/);
    const fn = hashName(parts[0]);
    const ln = parts.length > 1 ? hashName(parts[parts.length - 1]) : null;
    if (fn) ud.fn = [fn];
    if (ln) ud.ln = [ln];
  }
  const ct = hashName(lead.city);
  if (ct) ud.ct = [ct];

  // external_id ajuda o Meta a deduplicar/associar (id do lead, hasheado).
  ud.external_id = [sha256(lead.id)];

  // Sinais de clique/navegador — puros (Fase 2). fbc é o mais forte.
  if (lead.fbc) ud.fbc = lead.fbc;
  if (lead.fbp) ud.fbp = lead.fbp;
  if (lead.clientIp) ud.client_ip_address = lead.clientIp;
  if (lead.clientUserAgent) ud.client_user_agent = lead.clientUserAgent;
  return ud;
}

/** true quando o lead tem sinais de origem web (habilita action_source=website). */
function hasWebSignals(lead: LeadLike): boolean {
  return !!(lead.fbc || lead.fbp || lead.eventSourceUrl);
}

export type CapiResult = {
  ok: boolean;
  status: string; // "ok" | "error: ..."
  eventsReceived?: number;
  fbtraceId?: string;
  skipped?: "disabled" | "not_configured" | "no_match_keys";
};

type SendParams = {
  pixelId: string;
  accessToken: string;
  eventName: string;
  currency: string;
  testEventCode?: string | null;
  lead: LeadLike;
  value: number;
  /** id determinístico do evento (dedup no Meta). Ex: `${lead.id}:won`. */
  eventId: string;
  /** unix seconds. Default: agora. */
  eventTime?: number;
};

/**
 * POST cru pro endpoint /{pixelId}/events. Não busca config nem persiste nada —
 * é a camada de transporte, testável isolada.
 */
export async function postConversionEvent(p: SendParams): Promise<CapiResult> {
  const userData = buildUserData(p.lead);
  // Sem chave de match (email/telefone/external_id) o evento é inútil.
  if (!userData.em && !userData.ph) {
    return { ok: false, status: "error: lead sem email nem telefone (sem chave de match)", skipped: "no_match_keys" };
  }

  // Com sinais web (fbc/fbp/url) o evento é "website" — match muito melhor.
  // Sem eles, é uma conversão gerada pelo sistema (venda registrada no CRM).
  const web = hasWebSignals(p.lead);
  const eventObj: Record<string, unknown> = {
    event_name: p.eventName,
    event_time: p.eventTime ?? Math.floor(Date.now() / 1000),
    action_source: web ? "website" : "system_generated",
    event_id: p.eventId,
    user_data: userData,
    custom_data: {
      value: Number(p.value.toFixed(2)),
      currency: p.currency,
    },
  };
  if (web && p.lead.eventSourceUrl) {
    eventObj.event_source_url = p.lead.eventSourceUrl;
  }
  const payload: Record<string, unknown> = { data: [eventObj] };
  if (p.testEventCode?.trim()) {
    payload.test_event_code = p.testEventCode.trim();
  }

  try {
    const res = await fetch(`${GRAPH}/${p.pixelId}/events?access_token=${encodeURIComponent(p.accessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      const msg = json?.error?.message ?? `HTTP ${res.status}`;
      return { ok: false, status: `error: ${msg}`, fbtraceId: json?.fbtrace_id };
    }
    return { ok: true, status: "ok", eventsReceived: json?.events_received, fbtraceId: json?.fbtrace_id };
  } catch (e: any) {
    return { ok: false, status: `error: ${e?.message ?? "falha de rede"}` };
  }
}

// ── Outbox (Fase 3): grava log → envia → reprocessa PENDING/FAILED via cron ──

const MAX_ATTEMPTS = 5;
// Backoff exponencial: ~1, 2, 4, 8, 16 min entre tentativas (teto de 60 min).
function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts, 60) * 60_000;
}
function matchQualityOf(lead: LeadLike): string {
  return hasWebSignals(lead) ? "website" : "system_generated";
}

type SendCtx = {
  companyId: string;
  eventName: string;
  eventId: string;
  value: number;
  lead: LeadLike;
};

/** Faz o POST e persiste o resultado no MetaConversionLog + no resumo da config. */
async function finishSend(
  pixelId: string, token: string, testEventCode: string | null, currency: string,
  logId: string, priorAttempts: number, ctx: SendCtx,
): Promise<CapiResult> {
  const result = await postConversionEvent({
    pixelId, accessToken: token, eventName: ctx.eventName, currency,
    testEventCode, lead: ctx.lead, value: ctx.value, eventId: ctx.eventId,
  });

  const attempts = priorAttempts + 1;
  // Sem chave de match nunca vai melhorar sozinho — não adianta reagendar.
  const giveUp = attempts >= MAX_ATTEMPTS || result.skipped === "no_match_keys";

  await prisma.metaConversionLog.update({
    where: { id: logId },
    data: result.ok
      ? {
          status: "SENT", sentAt: new Date(), attempts,
          matchQuality: matchQualityOf(ctx.lead),
          eventsReceived: result.eventsReceived ?? null,
          fbtraceId: result.fbtraceId ?? null, lastError: null, nextRetryAt: null,
        }
      : {
          status: "FAILED", attempts, lastError: result.status,
          matchQuality: matchQualityOf(ctx.lead),
          fbtraceId: result.fbtraceId ?? null,
          nextRetryAt: giveUp ? null : new Date(Date.now() + backoffMs(attempts)),
        },
  }).catch(() => {});

  await prisma.metaConversionConfig.update({
    where: { companyId: ctx.companyId },
    data: { lastEventAt: new Date(), lastStatus: result.status },
  }).catch(() => {});

  return result;
}

/**
 * Grava (ou reaproveita) o log do evento e tenta enviar na hora. Idempotente por
 * (companyId,eventId): se já foi SENT, não reenvia. Em falha, marca FAILED com
 * nextRetryAt pro cron reprocessar. Base de sendLeadWon/PromotedConversion.
 */
async function enqueueConversion(kind: "won" | "lead", lead: LeadLike & { companyId: string }, value: number): Promise<CapiResult> {
  const cfg = await prisma.metaConversionConfig.findUnique({ where: { companyId: lead.companyId } });
  if (!cfg) return { ok: false, status: "not_configured", skipped: "not_configured" };
  if (!cfg.enabled) return { ok: false, status: "disabled", skipped: "disabled" };

  const eventName = kind === "lead" ? "Lead" : cfg.eventName;
  const eventId = `${lead.id}:${kind === "lead" ? "lead" : "won"}`;

  // Idempotência: já enviado antes → não duplica.
  const existing = await prisma.metaConversionLog.findUnique({
    where: { companyId_eventId: { companyId: lead.companyId, eventId } },
    select: { status: true },
  });
  if (existing?.status === "SENT") return { ok: true, status: "ok (já enviado)" };

  let token: string;
  try {
    token = decryptSecret(cfg.accessTokenEnc);
  } catch {
    const status = "error: token CAPI ilegível (ENCRYPTION_KEY trocada?)";
    await prisma.metaConversionConfig.update({ where: { companyId: lead.companyId }, data: { lastStatus: status } }).catch(() => {});
    return { ok: false, status };
  }

  const log = await prisma.metaConversionLog.upsert({
    where: { companyId_eventId: { companyId: lead.companyId, eventId } },
    create: {
      companyId: lead.companyId, leadId: lead.id, eventName, eventId,
      value, currency: cfg.currency, matchQuality: matchQualityOf(lead), status: "PENDING",
    },
    // Re-disparo do mesmo evento (ainda não enviado): atualiza valor/match caso
    // tenham mudado desde a 1ª tentativa. Não mexe em attempts/status.
    update: { value, currency: cfg.currency, matchQuality: matchQualityOf(lead) },
    select: { id: true, attempts: true },
  });

  return finishSend(cfg.pixelId, token, cfg.testEventCode, cfg.currency, log.id, log.attempts, {
    companyId: lead.companyId, eventName, eventId, value, lead,
  });
}

/** Conversão de VENDA GANHA (event_name = eventName da config, ex: Purchase). */
export async function sendLeadWonConversion(lead: LeadLike & { companyId: string }): Promise<CapiResult> {
  return enqueueConversion("won", lead, lead.value ?? 0);
}

/** Evento "Lead" — meio de funil, disparado na promoção pra Oportunidade. */
export async function sendLeadPromotedConversion(lead: LeadLike & { companyId: string }): Promise<CapiResult> {
  return enqueueConversion("lead", lead, 0);
}

/**
 * Reprocessa eventos PENDING/FAILED (chamado pelo cron). Rebusca o lead pra
 * remontar os dados de match e reenvia com backoff. Eventos de teste (leadId
 * null) não retentam. Retorna um resumo pra observabilidade do cron.
 */
export async function retryPendingConversions(limit = 50): Promise<{ processed: number; sent: number; failed: number }> {
  const due = await prisma.metaConversionLog.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      attempts: { lt: MAX_ATTEMPTS },
      leadId: { not: null },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, companyId: true, leadId: true, eventName: true, eventId: true, value: true, attempts: true },
  });

  let sent = 0, failed = 0;
  for (const log of due) {
    const cfg = await prisma.metaConversionConfig.findUnique({ where: { companyId: log.companyId } });
    if (!cfg || !cfg.enabled) { failed++; continue; } // config sumiu/pausada — tenta depois
    let token: string;
    try { token = decryptSecret(cfg.accessTokenEnc); } catch { failed++; continue; }

    const lead = await prisma.lead.findUnique({
      where: { id: log.leadId! },
      select: {
        id: true, name: true, email: true, phone: true, city: true,
        fbc: true, fbp: true, eventSourceUrl: true, clientIp: true, clientUserAgent: true,
      },
    });
    if (!lead) {
      await prisma.metaConversionLog.update({ where: { id: log.id }, data: { status: "FAILED", lastError: "lead removido", nextRetryAt: null } }).catch(() => {});
      failed++; continue;
    }

    const r = await finishSend(cfg.pixelId, token, cfg.testEventCode, cfg.currency, log.id, log.attempts, {
      companyId: log.companyId, eventName: log.eventName, eventId: log.eventId, value: log.value ?? 0, lead,
    });
    if (r.ok) sent++; else failed++;
  }

  return { processed: due.length, sent, failed };
}

/**
 * Envia um evento de TESTE (usa o test_event_code se configurado). Serve pro
 * botão "Enviar evento de teste" na tela de config — o cliente confirma no
 * Events Manager que a conexão está viva antes de confiar no fluxo real.
 * Também grava um MetaConversionLog (leadId null) pra aparecer no diagnóstico.
 */
export async function sendTestConversion(companyId: string): Promise<CapiResult> {
  const cfg = await prisma.metaConversionConfig.findUnique({ where: { companyId } });
  if (!cfg) return { ok: false, status: "not_configured", skipped: "not_configured" };

  let token: string;
  try {
    token = decryptSecret(cfg.accessTokenEnc);
  } catch {
    return { ok: false, status: "error: token CAPI ilegível (ENCRYPTION_KEY trocada?)" };
  }

  const eventId = `test:${companyId}:${Math.floor(Date.now() / 1000)}`;
  const lead: LeadLike = {
    id: `test-${companyId}`,
    name: "Teste LeadHub",
    email: "teste-leadhub@example.com",
    phone: "5511999999999",
    value: 1,
  };

  const log = await prisma.metaConversionLog.create({
    data: {
      companyId, leadId: null, eventName: cfg.eventName, eventId,
      value: 1, currency: cfg.currency, matchQuality: matchQualityOf(lead), status: "PENDING",
    },
    select: { id: true },
  });

  const result = await finishSend(cfg.pixelId, token, cfg.testEventCode, cfg.currency, log.id, 0, {
    companyId, eventName: cfg.eventName, eventId, value: 1, lead,
  });

  await prisma.metaConversionConfig
    .update({ where: { companyId }, data: { lastStatus: `teste — ${result.status}` } })
    .catch(() => {});

  return result;
}
