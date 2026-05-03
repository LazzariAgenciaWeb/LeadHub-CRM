/**
 * webhook-auth.ts
 *
 * Defesas em rotas de webhook público (Evolution, Stripe, etc.):
 *  - Token compartilhado por query param ou header
 *  - Rate limit em memória por IP (single-instance — em multi-instância
 *    troque por Redis ou tabela com TTL)
 *  - Validação de schema básica
 */

import { NextResponse } from "next/server";

/**
 * Constrói a URL completa do webhook do WhatsApp anexando o token quando
 * a env var existe. Ponto único pra mudar o formato (token na query agora,
 * mas pode virar HMAC no futuro sem mexer nos callers).
 */
export function buildWhatsappWebhookUrl(baseOrigin: string): string {
  const trimmed = baseOrigin.replace(/\/$/, "");
  const url = `${trimmed}/api/webhook/whatsapp`;
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  return secret ? `${url}?token=${encodeURIComponent(secret)}` : url;
}

// ─── Token compartilhado ─────────────────────────────────────────────────────

/**
 * Valida token recebido contra a env var. Aceita 3 formatos:
 *   1. Query string: ?token=XXX (mais fácil de configurar na Evolution)
 *   2. Header: x-leadhub-webhook-token
 *   3. Header Authorization: Bearer XXX
 *
 * Em produção configure a Evolution com `?token=$WHATSAPP_WEBHOOK_SECRET`
 * na URL do webhook.
 */
export function verifyWebhookToken(req: Request, secret: string): boolean {
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken && queryToken === secret) return true;

  const headerToken = req.headers.get("x-leadhub-webhook-token");
  if (headerToken && headerToken === secret) return true;

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && auth.slice(7) === secret) return true;

  return false;
}

// ─── Rate limit (in-memory, single instance) ─────────────────────────────────

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Token bucket por IP. Default 100 req/min — suficiente pra Evolution sem
 * ficar tão alto que abre brecha pra DDoS.
 *
 * Em multi-instance (Vercel/Railway com >1 réplica) cada container tem o
 * seu map — a proteção fica aproximada (cliente pode bater limite por
 * réplica). Pra produção com tráfego real, migrar pra Redis.
 */
export function checkRateLimit(
  identifier: string,
  limit: number = 100,
  windowMs: number = 60_000,
): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const existing = buckets.get(identifier);

  if (!existing || existing.resetAt < now) {
    const fresh = { count: 1, resetAt: now + windowMs };
    buckets.set(identifier, fresh);
    return { ok: true, remaining: limit - 1, resetAt: fresh.resetAt };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { ok: false, remaining: 0, resetAt: existing.resetAt };
  }
  return { ok: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}

export function extractIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0].trim() ||
    h.get("x-real-ip") ||
    h.get("cf-connecting-ip") ||
    "unknown"
  );
}

// ─── Helper composto ─────────────────────────────────────────────────────────

export interface WebhookGuardOpts {
  /** Env var name que guarda o secret (ex: "WHATSAPP_WEBHOOK_SECRET") */
  secretEnv: string;
  /** Limite de req/min por IP (default 100) */
  rateLimit?: number;
  /** Janela em ms (default 60s) */
  windowMs?: number;
}

export type WebhookGuardResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

/**
 * Aplica token + rate limit. Retorna `{ ok: false, response }` pra rota
 * devolver direto. Token ausente em env => deny-by-default em produção,
 * permite em dev sem env (warn no console).
 */
export function guardWebhook(
  req: Request,
  opts: WebhookGuardOpts,
): WebhookGuardResult {
  const secret = process.env[opts.secretEnv];

  // Token ausente: deny em produção, permite em dev
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return {
        ok: false,
        response: NextResponse.json(
          { error: `Webhook secret (${opts.secretEnv}) não configurado` },
          { status: 500 },
        ),
      };
    }
    console.warn(`[Webhook] ${opts.secretEnv} não configurado — aceitando em dev`);
  } else {
    if (!verifyWebhookToken(req, secret)) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Token inválido" }, { status: 401 }),
      };
    }
  }

  const ip = extractIp(req);
  const rl = checkRateLimit(ip, opts.rateLimit ?? 100, opts.windowMs ?? 60_000);
  if (!rl.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Rate limit excedido" },
        {
          status: 429,
          headers: {
            "retry-after": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
          },
        },
      ),
    };
  }

  return { ok: true };
}
