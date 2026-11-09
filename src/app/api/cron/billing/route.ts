/**
 * GET/POST /api/cron/billing
 *
 * Cron diário (idealmente 03:00 BRT) que:
 *   1. Detecta trial expirado (TRIALING + trialEndsAt < now) → downgrade pra FREE
 *   2. Detecta subscription PAST_DUE há > 7 dias → vira UNPAID (corte gracioso)
 *   3. Anual no Pix: avisa antes de vencer e tira o plano depois da tolerância
 *
 * Sem isso, cliente que cancela ou não paga continua com plano pago indefinidamente
 * — rede de segurança caso o webhook do Stripe perca um evento.
 *
 * Segurança: header `Authorization: Bearer <CRON_SECRET>`.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/email";
import { syncCompanyModuleFlags } from "@/lib/billing-sync";
import { PAGE_LINE_PAID, PAGE_LINE_TIERS, PLANS } from "@/lib/plans";
import { pixAnnualAction, PIX_ANNUAL_PRICE_ID } from "@/lib/pix-annual";

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
  const results = { trialExpired: 0, pastDueExpired: 0, pixReminders: 0, pixExpired: 0 };
  // scope=pix é o agendamento do start.sh: trata só o anual no Pix.
  const onlyPix = req.nextUrl.searchParams.get("scope") === "pix";

  // 1. Trial vencido — vira FREE
  const expiredTrials = onlyPix ? [] : await prisma.subscription.findMany({
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
  const expiredPastDue = onlyPix ? [] : await prisma.subscription.findMany({
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

  // 3. Anual no Pix: não há assinatura na Stripe, a validade é nossa.
  const pixSubs = await prisma.subscription.findMany({
    where: { stripePriceId: PIX_ANNUAL_PRICE_ID, status: "ACTIVE", currentPeriodEnd: { not: null } },
    select: {
      id: true, companyId: true, plan: true, currentPeriodStart: true, currentPeriodEnd: true,
      company: { select: { name: true, email: true } },
    },
  });

  for (const sub of pixSubs) {
    const sentEvents = await prisma.billingEvent.findMany({
      where: { companyId: sub.companyId, type: "pix_annual_reminder", createdAt: { gte: sub.currentPeriodStart ?? undefined } },
      select: { metadata: true },
    });
    const sent = sentEvents.map((e) => Number((e.metadata as { days?: number } | null)?.days)).filter(Number.isFinite);
    const action = pixAnnualAction(sub.currentPeriodEnd!, now, sent);

    if (action.type === "expire") {
      const pageLine = PAGE_LINE_PAID.includes(sub.plan) || PAGE_LINE_TIERS.includes(sub.plan);
      await prisma.subscription.update({
        where: { id: sub.id },
        data: pageLine
          ? { plan: "FREE", status: "ACTIVE", canceledAt: now, stripePriceId: null, currentPeriodEnd: null }
          : { status: "CANCELED", canceledAt: now, stripePriceId: null },
      });
      await syncCompanyModuleFlags(sub.companyId);
      await prisma.billingEvent.create({
        data: { companyId: sub.companyId, type: "pix_annual_expired", fromPlan: sub.plan, toPlan: pageLine ? "FREE" : sub.plan },
      }).catch(() => {});
      results.pixExpired++;
    }

    if (action.type === "remind") {
      if (!sub.company.email) continue;
      const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
      const link = `${base}${PAGE_LINE_PAID.includes(sub.plan) ? "/pagina" : "/configuracoes?secao=minha-empresa-plano"}`;
      const until = sub.currentPeriodEnd!.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const label = PLANS[sub.plan].label;
      try {
        await sendMail({
          to: sub.company.email,
          subject: `Seu plano ${label} do GoHub vence em ${until}`,
          html: `<p>Olá!</p><p>Seu plano <b>${label}</b> do GoHub, pago por Pix, vale até <b>${until}</b>. O Pix não renova sozinho.</p><p>Para continuar sem interrupção, renove pelo painel: <a href="${link}">${link}</a></p>`,
        });
      } catch (err) {
        console.error(`[cron billing] aviso Pix ${sub.companyId}:`, err);
        continue;
      }
      await prisma.billingEvent.create({
        data: { companyId: sub.companyId, type: "pix_annual_reminder", metadata: { days: action.days } },
      }).catch(() => {});
      results.pixReminders++;
    }
  }

  return NextResponse.json({ ok: true, ...results });
}

export const GET  = handle;
export const POST = handle;
