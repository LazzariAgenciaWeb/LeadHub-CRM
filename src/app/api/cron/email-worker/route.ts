/**
 * Worker de envio de email — chamado pelo start.sh a cada 60s.
 *
 * Por chamada:
 *  1. Lista campanhas em SENDING.
 *  2. Pra cada uma: checa cadência (janela horário + dia + quota última hora).
 *  3. Calcula quantos emails posso mandar neste tick (delta da quota).
 *  4. Pega N recipients PENDING ordenados por createdAt.
 *  5. Renderiza + envia 1 por 1 com jitter entre cada.
 *  6. Atualiza status do recipient + counters da campanha.
 *  7. Se não sobrou ninguém PENDING, marca campanha COMPLETED.
 *
 * Roda como cron HTTP (mesmo padrão de /api/cron/sla). Protegido por CRON_SECRET
 * se a env existir.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { renderTemplate } from "@/lib/email-render";
import { injectTracking } from "@/lib/email-tracking";
import { sendCompanyMail, getCompanyEmailConfig } from "@/lib/company-email";
import {
  checkCadence, jitterDelayMs, sleep, DEFAULT_CADENCE, type CadenceConfig,
} from "@/lib/email-cadence";

// Quantos recipients no MÁXIMO por tick por campanha (evita travar handler)
const MAX_PER_TICK = 20;

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  // Auth via CRON_SECRET se definido (mesmo padrão do start.sh em outras crons)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const startedAt = new Date();
  const summary: any[] = [];

  // 1) Promove SCHEDULED → SENDING quando chega a hora
  await prisma.emailCampaign.updateMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: startedAt } },
    data: { status: "SENDING" },
  });

  // 2) Pega campanhas ativas
  const active = await prisma.emailCampaign.findMany({
    where: { status: "SENDING" },
    take: 25, // não absurdo num tick
  });

  for (const campaign of active) {
    const cfg: CadenceConfig = { ...DEFAULT_CADENCE, ...(campaign.cadenceConfig as any) };
    const now = new Date();

    // Quantos foram enviados na última hora (anti-burst)
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const sentLastHour = await prisma.emailRecipient.count({
      where: { campaignId: campaign.id, sentAt: { gte: oneHourAgo } },
    });

    const gate = checkCadence(cfg, now, sentLastHour);
    if (!gate.ok) {
      summary.push({ campaign: campaign.id, skipped: gate.reason });
      continue;
    }

    // Quanto sobra na quota desta hora
    const remainingQuota = Math.max(0, cfg.maxPerHour - sentLastHour);
    const toProcess = Math.min(remainingQuota, MAX_PER_TICK);

    if (toProcess === 0) {
      summary.push({ campaign: campaign.id, skipped: "quota cheia" });
      continue;
    }

    const recipients = await prisma.emailRecipient.findMany({
      where: { campaignId: campaign.id, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: toProcess,
    });

    if (recipients.length === 0) {
      // Acabaram os pendentes: confere se TUDO já saiu e marca COMPLETED
      const remaining = await prisma.emailRecipient.count({
        where: { campaignId: campaign.id, status: { in: ["PENDING", "SENDING"] } },
      });
      if (remaining === 0) {
        await prisma.emailCampaign.update({
          where: { id: campaign.id },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
        summary.push({ campaign: campaign.id, completed: true });
      }
      continue;
    }

    // Pega template + SMTP da empresa
    const [template, smtpOk] = await Promise.all([
      prisma.emailTemplate.findUnique({ where: { id: campaign.templateId } }),
      getCompanyEmailConfig(campaign.companyId).then((c) => !!c),
    ]);

    if (!template) {
      await prisma.emailCampaign.update({
        where: { id: campaign.id },
        data: { status: "FAILED" },
      });
      summary.push({ campaign: campaign.id, failed: "template removido" });
      continue;
    }
    if (!smtpOk) {
      summary.push({ campaign: campaign.id, skipped: "SMTP não configurado" });
      continue;
    }

    let sent = 0, failed = 0;
    for (const r of recipients) {
      // Marca SENDING pra outros ticks não pegarem o mesmo
      await prisma.emailRecipient.update({
        where: { id: r.id },
        data: { status: "SENDING" },
      });

      const vars = (r.vars ?? {}) as Record<string, any>;
      const rendered = renderTemplate(
        { subject: campaign.subject || template.subject, html: template.html, text: template.text },
        vars
      );
      // Injeta pixel + reescreve links + footer com unsubscribe
      const tracked = injectTracking(rendered.html, r.token);

      try {
        await sendCompanyMail(campaign.companyId, {
          to: r.email,
          subject: rendered.subject,
          html: tracked.html,
          text: rendered.text,
          headers: {
            // RFC 8058: 1-click unsubscribe (Gmail/Yahoo bonificam emails que respeitam)
            "List-Unsubscribe": tracked.listUnsubscribeHeader,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            "X-Campaign-Id": campaign.id,
            "X-Recipient-Token": r.token,
          },
        });
        await prisma.$transaction([
          prisma.emailRecipient.update({
            where: { id: r.id },
            data: { status: "SENT", sentAt: new Date() },
          }),
          prisma.emailCampaign.update({
            where: { id: campaign.id },
            data: { sentCount: { increment: 1 } },
          }),
        ]);
        sent++;
      } catch (e: any) {
        const errorMessage = (e?.message ?? "Erro desconhecido").slice(0, 500);
        // Detecção ingênua de bounce — SMTP que rejeita o destinatário (550 etc).
        const isBounce = /550|554|recipient.*reject|user unknown|mailbox.*not/i.test(errorMessage);
        await prisma.$transaction([
          prisma.emailRecipient.update({
            where: { id: r.id },
            data: {
              status: isBounce ? "BOUNCED" : "FAILED",
              bouncedAt: isBounce ? new Date() : null,
              errorMessage,
            },
          }),
          prisma.emailCampaign.update({
            where: { id: campaign.id },
            data: isBounce
              ? { bouncedCount: { increment: 1 } }
              : { failedCount: { increment: 1 } },
          }),
        ]);
        failed++;
      }

      // Jitter entre envios
      await sleep(jitterDelayMs(cfg));

      // Checa de novo a quota — pode ter estourado durante o lote
      const recheck = await prisma.emailRecipient.count({
        where: { campaignId: campaign.id, sentAt: { gte: oneHourAgo } },
      });
      if (recheck >= cfg.maxPerHour) break;
    }

    summary.push({ campaign: campaign.id, sent, failed });
  }

  return NextResponse.json({
    ok: true,
    tookMs: Date.now() - startedAt.getTime(),
    summary,
  });
}
