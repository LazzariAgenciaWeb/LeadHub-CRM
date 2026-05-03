/**
 * GET/POST /api/cron/billing
 *
 * Cron diário (idealmente 03:00 BRT) que:
 *   1. Detecta trial expirado (TRIALING + trialEndsAt < now) → downgrade pra FREE
 *   2. Detecta subscription PAST_DUE há > 7 dias → vira UNPAID (corte gracioso)
 *
 * Sem isso, cliente que cancela ou não paga continua com plano pago indefinidamente
 * — rede de segurança caso o webhook do Stripe perca um evento.
 *
 * Segurança: header `Authorization: Bearer <CRON_SECRET>`.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PAST_DUE_GRACE_DAYS = 7;

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const now = new Date();
  const results = { trialExpired: 0, pastDueExpired: 0 };

  // 1. Trial vencido — vira FREE
  const expiredTrials = await prisma.subscription.findMany({
    where: {
      status:      "TRIALING",
      trialEndsAt: { lt: now },
    },
    select: { id: true, companyId: true, plan: true },
  });

  for (const sub of expiredTrials) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: "ACTIVE",  // Mantém status válido — FREE é um plano ativo
        plan:   "FREE",
      },
    });
    await prisma.billingEvent.create({
      data: {
        companyId: sub.companyId,
        type:      "trial_ended",
        fromPlan:  sub.plan,
        toPlan:    "FREE",
        metadata:  { reason: "auto_downgrade", trialExpiredAt: now.toISOString() },
      },
    }).catch(() => {});
    results.trialExpired++;
  }

  // 2. PAST_DUE > N dias → UNPAID (acesso bloqueado)
  const cutoff = new Date(now.getTime() - PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const expiredPastDue = await prisma.subscription.findMany({
    where: {
      status:    "PAST_DUE",
      updatedAt: { lt: cutoff },
    },
    select: { id: true, companyId: true, plan: true },
  });

  for (const sub of expiredPastDue) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data:  { status: "UNPAID" },
    });
    await prisma.billingEvent.create({
      data: {
        companyId: sub.companyId,
        type:      "marked_unpaid",
        fromPlan:  sub.plan,
        toPlan:    sub.plan,
        metadata:  { reason: "past_due_expired", graceDays: PAST_DUE_GRACE_DAYS },
      },
    }).catch(() => {});
    results.pastDueExpired++;
  }

  return NextResponse.json({ ok: true, ...results });
}

export const GET  = handle;
export const POST = handle;
