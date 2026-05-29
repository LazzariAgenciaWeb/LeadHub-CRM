import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decodeRedirectUrl } from "@/lib/email-tracking";
import { sendPushToUser } from "@/lib/push";

// GET /api/email/track/click?t=TOKEN&u=BASE64URL → grava CLICK, redireciona
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");
  const enc = req.nextUrl.searchParams.get("u");

  // Sem destino: 404 puro (não tentamos adivinhar)
  if (!enc) return NextResponse.json({ error: "missing url" }, { status: 400 });
  const target = decodeRedirectUrl(enc);
  if (!target) return NextResponse.json({ error: "invalid url" }, { status: 400 });

  // Gravar evento fire-and-forget — não atrasa o redirect
  if (token) {
    void recordClick(token, target, req).catch(() => null);
  }

  return NextResponse.redirect(target, 302);
}

async function recordClick(token: string, targetUrl: string, req: NextRequest) {
  const recipient = await prisma.emailRecipient.findUnique({
    where: { token },
    select: {
      id: true, firstClickedAt: true, campaignId: true, leadId: true,
      lead: {
        select: {
          id: true, name: true, phone: true, pipeline: true, companyId: true,
          conversation: { select: { assigneeId: true } },
        },
      },
    },
  });
  if (!recipient) return;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent") ?? null;

  await prisma.emailEvent.create({
    data: { recipientId: recipient.id, type: "CLICK", targetUrl, ipAddress: ip, userAgent: ua },
  });

  // Primeira interação: incrementa contador
  if (!recipient.firstClickedAt) {
    await prisma.$transaction([
      prisma.emailRecipient.update({
        where: { id: recipient.id },
        data: { firstClickedAt: new Date() },
      }),
      prisma.emailCampaign.update({
        where: { id: recipient.campaignId },
        data: { clickedCount: { increment: 1 } },
      }),
    ]).catch(() => null);
  }

  // Activity + Prospect→Lead promotion + push (mesma lógica do shortlink)
  const lead = recipient.lead;
  if (!lead) return;

  await prisma.activity.create({
    data: {
      type: "NOTE_ADDED",
      leadId: lead.id,
      companyId: lead.companyId,
      authorName: "Sistema",
      body: `🖱️ Clicou no email: ${targetUrl}`,
      meta: { kind: "email_click", url: targetUrl, recipientId: recipient.id },
    },
  }).catch(() => null);

  const assigneeId = lead.conversation?.assigneeId ?? null;

  // Promove prospect demonstrando interesse
  if (lead.pipeline === "PROSPECCAO") {
    const firstStage = await prisma.pipelineStageConfig.findFirst({
      where: { companyId: lead.companyId, pipeline: "LEADS" },
      orderBy: { order: "asc" },
      select: { name: true },
    });
    const targetStage = firstStage?.name ?? "Novo Lead";

    await prisma.lead.update({
      where: { id: lead.id },
      data: { pipeline: "LEADS", pipelineStage: targetStage },
    });
    await prisma.activity.create({
      data: {
        type: "PIPELINE_CHANGED",
        leadId: lead.id,
        companyId: lead.companyId,
        authorName: "Sistema",
        body: `Prospect demonstrou interesse (clicou no email) → movido para Leads`,
        meta: { from: "PROSPECCAO", to: "LEADS", reason: "email_click", url: targetUrl },
      },
    }).catch(() => null);

    if (assigneeId) {
      await sendPushToUser(
        assigneeId,
        {
          title: "🎯 Prospect demonstrou interesse (email)!",
          body: `${lead.name ?? lead.phone} clicou no email e virou Lead. Atenda agora.`,
          url: `/crm/leads?lead=${lead.id}`,
          tag: `promote-${lead.id}`,
        },
        "hotSignal"
      );
    }
  }
}
