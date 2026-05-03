/**
 * POST /api/webhooks/stripe
 *
 * Webhook do Stripe — único ponto que persiste mudanças de assinatura.
 *
 * Configuração:
 *   1. Stripe Dashboard → Developers → Webhooks → Add endpoint
 *   2. URL: https://seu-dominio.com/api/webhooks/stripe
 *   3. Events: customer.subscription.created/updated/deleted,
 *              invoice.payment_succeeded, invoice.payment_failed,
 *              customer.subscription.trial_will_end
 *   4. Copiar Signing secret pra STRIPE_WEBHOOK_SECRET
 *
 * Eventos tratados:
 *   - customer.subscription.created/updated → upsert Subscription, status, period
 *   - customer.subscription.deleted        → status=CANCELED
 *   - invoice.payment_succeeded            → BillingEvent payment_succeeded
 *   - invoice.payment_failed               → status=PAST_DUE + BillingEvent
 *   - customer.subscription.trial_will_end → BillingEvent trial_ending (3 dias antes)
 *
 * Idempotência: cada evento Stripe tem `id`. Em produção registre eventos
 * processados numa tabela pra evitar dupla aplicação em retry. Por hora,
 * upsert no Subscription cobre 95% dos casos (estado final é o mesmo).
 */

import type Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripe, mapStripeStatus, planForPriceId } from "@/lib/stripe";

// Webhooks devem ler o body cru pra validar a assinatura.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.error("[Stripe] STRIPE_WEBHOOK_SECRET não configurado");
    return NextResponse.json({ error: "Webhook não configurado" }, { status: 500 });
  }
  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  const raw = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err: any) {
    console.error("[Stripe] Assinatura inválida:", err.message);
    return NextResponse.json({ error: `Assinatura inválida: ${err.message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpsert(event.data.object as Stripe.Subscription);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case "invoice.payment_succeeded":
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case "customer.subscription.trial_will_end":
        await handleTrialWillEnd(event.data.object as Stripe.Subscription);
        break;

      default:
        // Eventos não tratados retornam 200 mesmo — Stripe para de retry quando
        // recebemos OK, e a maioria dos eventos não precisa ação nossa.
        console.log(`[Stripe] Evento ignorado: ${event.type}`);
    }
    return NextResponse.json({ received: true });
  } catch (err: any) {
    // 5xx faz Stripe re-enviar. Útil pra erros transitórios de DB.
    console.error(`[Stripe] Erro processando ${event.type}:`, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleSubscriptionUpsert(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // Identifica a Company. 2 caminhos:
  //   1. Já temos uma Subscription com esse stripeCustomerId
  //   2. Stripe metadata.companyId (setado no checkout)
  const existing = await prisma.subscription.findUnique({
    where: { stripeCustomerId: customerId },
    select: { companyId: true, plan: true },
  });

  const companyId =
    existing?.companyId ??
    (typeof sub.metadata?.companyId === "string" ? sub.metadata.companyId : null);

  if (!companyId) {
    console.error(`[Stripe] Subscription ${sub.id} sem companyId no metadata e sem Subscription prévia`);
    return;
  }

  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? null;
  const plan = priceId ? planForPriceId(priceId) : null;
  const status = mapStripeStatus(sub.status);

  const updated = await prisma.subscription.upsert({
    where: { companyId },
    create: {
      companyId,
      plan:                 plan ?? "FREE",
      status,
      billingCycle:         item?.price?.recurring?.interval === "year" ? "annual" : "monthly",
      stripeCustomerId:     customerId,
      stripeSubscriptionId: sub.id,
      stripePriceId:        priceId,
      currentPeriodStart:   sub.current_period_start ? new Date(sub.current_period_start * 1000) : null,
      currentPeriodEnd:     sub.current_period_end   ? new Date(sub.current_period_end   * 1000) : null,
      cancelAtPeriodEnd:    sub.cancel_at_period_end ?? false,
      canceledAt:           sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      trialEndsAt:          sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    },
    update: {
      ...(plan && { plan }),
      status,
      billingCycle:         item?.price?.recurring?.interval === "year" ? "annual" : "monthly",
      stripeSubscriptionId: sub.id,
      stripePriceId:        priceId,
      currentPeriodStart:   sub.current_period_start ? new Date(sub.current_period_start * 1000) : null,
      currentPeriodEnd:     sub.current_period_end   ? new Date(sub.current_period_end   * 1000) : null,
      cancelAtPeriodEnd:    sub.cancel_at_period_end ?? false,
      canceledAt:           sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      trialEndsAt:          sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    },
  });

  // Trail de auditoria — distingue criação de upgrade/downgrade
  const eventType =
    !existing ? "subscribed"
    : (existing.plan !== updated.plan ? (planRank(updated.plan) > planRank(existing.plan) ? "upgraded" : "downgraded") : "updated");

  await prisma.billingEvent.create({
    data: {
      companyId,
      type:     eventType,
      fromPlan: existing?.plan,
      toPlan:   updated.plan,
      metadata: { stripeSubscriptionId: sub.id, status },
    },
  }).catch(() => {});
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const existing = await prisma.subscription.findUnique({
    where:  { stripeCustomerId: customerId },
    select: { companyId: true, plan: true },
  });
  if (!existing) return;

  await prisma.subscription.update({
    where: { companyId: existing.companyId },
    data: {
      status:     "CANCELED",
      canceledAt: new Date(),
    },
  });

  await prisma.billingEvent.create({
    data: {
      companyId: existing.companyId,
      type:      "canceled",
      fromPlan:  existing.plan,
      metadata:  { stripeSubscriptionId: sub.id },
    },
  }).catch(() => {});
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;

  const sub = await prisma.subscription.findUnique({
    where: { stripeCustomerId: customerId },
    select: { companyId: true },
  });
  if (!sub) return;

  await prisma.billingEvent.create({
    data: {
      companyId: sub.companyId,
      type:      "payment_succeeded",
      amount:    invoice.amount_paid ? invoice.amount_paid / 100 : null,
      metadata:  {
        invoiceId: invoice.id,
        currency:  invoice.currency,
        hosted:    invoice.hosted_invoice_url,
      },
    },
  }).catch(() => {});
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;

  const existing = await prisma.subscription.findUnique({
    where:  { stripeCustomerId: customerId },
    select: { companyId: true },
  });
  if (!existing) return;

  await prisma.subscription.update({
    where: { companyId: existing.companyId },
    data:  { status: "PAST_DUE" },
  });

  await prisma.billingEvent.create({
    data: {
      companyId: existing.companyId,
      type:      "payment_failed",
      amount:    invoice.amount_due ? invoice.amount_due / 100 : null,
      metadata:  {
        invoiceId:    invoice.id,
        attemptCount: invoice.attempt_count,
      },
    },
  }).catch(() => {});
}

async function handleTrialWillEnd(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const existing = await prisma.subscription.findUnique({
    where:  { stripeCustomerId: customerId },
    select: { companyId: true },
  });
  if (!existing) return;

  await prisma.billingEvent.create({
    data: {
      companyId: existing.companyId,
      type:      "trial_ending",
      metadata:  {
        trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      },
    },
  }).catch(() => {});
  // Email de aviso fica num próximo PR — exige template + i18n.
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PLAN_ORDER: Record<string, number> = {
  FREE: 0, TRIAL: 1, ESSENCIAL: 2, MARKETING: 3,
  CRESCIMENTO: 4, PREMIUM: 5, ENTERPRISE: 6,
};

function planRank(plan: string): number {
  return PLAN_ORDER[plan] ?? 0;
}
