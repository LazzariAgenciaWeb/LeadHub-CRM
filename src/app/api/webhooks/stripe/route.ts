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
 *              customer.subscription.trial_will_end,
 *              checkout.session.completed,
 *              checkout.session.async_payment_succeeded,
 *              checkout.session.async_payment_failed (anual no Pix)
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
import { PAGE_LINE_PAID, PAGE_LINE_TIERS } from "@/lib/plans";
import { syncCompanyModuleFlags } from "@/lib/billing-sync";
import { isPixAnnualTier, pixAnnualPeriod, PIX_ANNUAL_KIND, PIX_ANNUAL_PRICE_ID } from "@/lib/pix-annual";

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

      // Anual no Pix: a sessão pode concluir ainda sem o dinheiro confirmado.
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handlePixAnnualPaid(event.data.object as Stripe.Checkout.Session);
        break;

      case "checkout.session.async_payment_failed":
        await handlePixAnnualFailed(event.data.object as Stripe.Checkout.Session);
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
  // Webhook em versão de API recente: o período fica no item, não na assinatura.
  const periodItem = item as (typeof item & { current_period_start?: number; current_period_end?: number }) | undefined;
  const periodStart = sub.current_period_start ?? periodItem?.current_period_start;
  const periodEnd = sub.current_period_end ?? periodItem?.current_period_end;

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
      currentPeriodStart:   periodStart ? new Date(periodStart * 1000) : null,
      currentPeriodEnd:     periodEnd   ? new Date(periodEnd   * 1000) : null,
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
      currentPeriodStart:   periodStart ? new Date(periodStart * 1000) : null,
      currentPeriodEnd:     periodEnd   ? new Date(periodEnd   * 1000) : null,
      cancelAtPeriodEnd:    sub.cancel_at_period_end ?? false,
      canceledAt:           sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      trialEndsAt:          sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    },
  });

  await syncCompanyModuleFlags(companyId);

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
    // Linha Página: cancelou o Pro/Mini Site, a página volta pro Grátis (com
    // selo e limites) em vez de ficar com o plano pago pra sempre.
    data: PAGE_LINE_TIERS.includes(existing.plan) || PAGE_LINE_PAID.includes(existing.plan)
      ? { plan: PAGE_LINE_TIERS.includes(existing.plan) ? "PAGINA" : "FREE", status: "ACTIVE", canceledAt: new Date(), stripeSubscriptionId: null, stripePriceId: null }
      : { status: "CANCELED", canceledAt: new Date() },
  });
  await syncCompanyModuleFlags(existing.companyId);

  await prisma.billingEvent.create({
    data: {
      companyId: existing.companyId,
      type:      "canceled",
      fromPlan:  existing.plan,
      metadata:  { stripeSubscriptionId: sub.id },
    },
  }).catch(() => {});
}

async function handlePixAnnualPaid(session: Stripe.Checkout.Session): Promise<void> {
  if (session.metadata?.kind !== PIX_ANNUAL_KIND || session.payment_status !== "paid") return;
  const companyId = session.metadata.companyId;
  const tier = session.metadata.tier;
  if (!companyId || !isPixAnnualTier(tier)) {
    console.error(`[Stripe] Pix anual ${session.id} com metadata inválido`);
    return;
  }

  // A Stripe reenvia eventos: pagar uma vez não pode somar dois anos.
  const done = await prisma.billingEvent.findFirst({
    where: { companyId, type: "pix_annual_paid", metadata: { path: ["checkoutSessionId"], equals: session.id } },
    select: { id: true },
  });
  if (done) return;

  const existing = await prisma.subscription.findUnique({
    where: { companyId },
    select: { plan: true, stripePriceId: true, currentPeriodEnd: true },
  });
  const period = pixAnnualPeriod(new Date(), existing && {
    sameTier: existing.plan === tier && existing.stripePriceId === PIX_ANNUAL_PRICE_ID,
    end: existing.currentPeriodEnd,
  });
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const data = {
    plan: tier,
    status: "ACTIVE" as const,
    billingCycle: "annual",
    stripeSubscriptionId: null,
    stripePriceId: PIX_ANNUAL_PRICE_ID,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    trialEndsAt: null,
    ...(customerId ? { stripeCustomerId: customerId } : {}),
  };
  await prisma.subscription.upsert({ where: { companyId }, create: { companyId, ...data }, update: data });
  await syncCompanyModuleFlags(companyId);

  await prisma.billingEvent.create({
    data: {
      companyId,
      type: "pix_annual_paid",
      fromPlan: existing?.plan,
      toPlan: tier,
      amount: session.amount_total ? session.amount_total / 100 : null,
      metadata: { checkoutSessionId: session.id, periodEnd: period.end.toISOString() },
    },
  });
}

async function handlePixAnnualFailed(session: Stripe.Checkout.Session): Promise<void> {
  if (session.metadata?.kind !== PIX_ANNUAL_KIND || !session.metadata.companyId) return;
  await prisma.billingEvent.create({
    data: {
      companyId: session.metadata.companyId,
      type: "payment_failed",
      amount: session.amount_total ? session.amount_total / 100 : null,
      metadata: { checkoutSessionId: session.id, method: "pix" },
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
