import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { evolutionSendText } from "@/lib/evolution";
import { upsertConversation } from "@/lib/whatsapp";

/**
 * GET/POST /api/cron/scheduled-messages
 *
 * Processa a fila de ScheduledMessage (lembretes de reunião do agente IA,
 * futuros follow-ups): envia via Evolution as mensagens PENDING vencidas e
 * persiste na conversa. Roda a cada ~2 min pelo loop do start.sh.
 *
 * Idempotência: marca SENDING antes de enviar (claim atômico via updateMany)
 * — duas execuções simultâneas não duplicam envio.
 */
async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const now = new Date();
  const due = await prisma.scheduledMessage.findMany({
    where: { status: "PENDING", sendAt: { lte: now } },
    orderBy: { sendAt: "asc" },
    take: 30,
  });

  let sent = 0, failed = 0, skipped = 0;

  for (const msg of due) {
    // Claim atômico — só processa se ainda estiver PENDING.
    const claimed = await prisma.scheduledMessage.updateMany({
      where: { id: msg.id, status: "PENDING" },
      data: { status: "SENDING" },
    });
    if (claimed.count === 0) { skipped++; continue; }

    try {
      if (!msg.instanceId) throw new Error("Mensagem sem instanceId");
      const instance = await prisma.whatsappInstance.findUnique({
        where: { id: msg.instanceId },
        select: { id: true, instanceName: true, instanceToken: true },
      });
      if (!instance) throw new Error("Instância não encontrada");

      const sendResult = await evolutionSendText(
        instance.instanceName,
        msg.phone,
        msg.body,
        (instance as any).instanceToken ?? null
      );
      const externalId: string = sendResult?.key?.id ?? sendResult?.id ?? `out-${Date.now()}-${msg.id.slice(-6)}`;

      const conv = await upsertConversation({
        companyId: msg.companyId,
        phone: msg.phone,
        direction: "OUTBOUND",
        body: msg.body,
        instanceId: instance.id,
      });
      await prisma.message.create({
        data: {
          externalId,
          body: msg.body,
          direction: "OUTBOUND",
          phone: msg.phone,
          instanceId: instance.id,
          companyId: msg.companyId,
          conversationId: conv.id,
          ack: 1,
          rawPayload: { autoAgent: true, scheduled: true, scheduledMessageId: msg.id } as any,
        },
      });

      await prisma.scheduledMessage.update({
        where: { id: msg.id },
        data: { status: "SENT", sentAt: new Date(), lastError: null },
      });
      sent++;
    } catch (err: any) {
      failed++;
      await prisma.scheduledMessage.update({
        where: { id: msg.id },
        data: { status: "FAILED", lastError: err?.message ?? String(err) },
      }).catch(() => {});
      console.error(`[Cron ScheduledMessages] falha id=${msg.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, due: due.length, sent, failed, skipped, timestamp: now.toISOString() });
}

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
