/**
 * stripe.ts — cliente Stripe singleton + helpers compartilhados pelo
 * webhook e por futuras rotas de checkout.
 *
 * Env vars necessárias:
 *   STRIPE_SECRET_KEY        — chave secreta da conta (sk_live_… / sk_test_…)
 *   STRIPE_WEBHOOK_SECRET    — secret do endpoint /api/webhooks/stripe
 *                              (Stripe Dashboard → Developers → Webhooks)
 *
 * Em dev, sem as envs, getStripe() lança — o caller decide se devolve 503
 * ou ignora.
 */

import Stripe from "stripe";
import type { PlanTier } from "./plans";

let _client: Stripe | null = null;

export function getStripe(): Stripe {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY não configurado");
  _client = new Stripe(key, {
    // Pin numa apiVersion estável — Stripe avisa quando precisa atualizar.
    apiVersion: "2025-01-27.acacia" as Stripe.LatestApiVersion,
  });
  return _client;
}

/**
 * Mapeia stripePriceId → PlanTier. Lookup ao contrário do PLANS, populado
 * a partir das envs STRIPE_PRICE_<TIER>_(MONTHLY|ANNUAL).
 *
 * Cada plano tem 2 preços (mensal e anual). Preencha as envs após criar
 * os Prices no Stripe Dashboard.
 */
export function planForPriceId(priceId: string): PlanTier | null {
  const map: Record<string, PlanTier> = {};
  const tiers: PlanTier[] = [
    "ESSENCIAL", "MARKETING", "CRESCIMENTO", "PREMIUM", "ENTERPRISE",
  ];
  for (const tier of tiers) {
    const m = process.env[`STRIPE_PRICE_${tier}_MONTHLY`];
    const a = process.env[`STRIPE_PRICE_${tier}_ANNUAL`];
    if (m) map[m] = tier;
    if (a) map[a] = tier;
  }
  return map[priceId] ?? null;
}

/**
 * Mapeia status do Stripe → SubscriptionStatus do Prisma. Stripe tem
 * "incomplete_expired" e "paused" que não existem no nosso enum — viram
 * INCOMPLETE e PAST_DUE respectivamente.
 */
export function mapStripeStatus(stripeStatus: string): "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "UNPAID" | "INCOMPLETE" {
  switch (stripeStatus) {
    case "trialing":              return "TRIALING";
    case "active":                return "ACTIVE";
    case "past_due":              return "PAST_DUE";
    case "canceled":              return "CANCELED";
    case "unpaid":                return "UNPAID";
    case "incomplete":            return "INCOMPLETE";
    case "incomplete_expired":    return "INCOMPLETE";
    case "paused":                return "PAST_DUE";
    default:                      return "INCOMPLETE";
  }
}
