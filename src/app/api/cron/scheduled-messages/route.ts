import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { evolutionSendText, evolutionSendMedia } from "@/lib/evolution";
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
  // Lookahead: pega também o que vence nos próximos 60s e AGUARDA o horário
  // exato de cada item — assim sequências com intervalo curto (ex.: 10s) saem
  // espaçadas de verdade, e não todas juntas na mesma rodada de 2 min.
  const LOOKAHEAD_MS = 60_000;
  const WAIT_BUDGET_MS = 75_000; // teto de espera por rodada (curl do cron: 120s)
  const due = await prisma.scheduledMessage.findMany({
    where: { status: "PENDING", sendAt: { lte: new Date(now.getTime() + LOOKAHEAD_MS) } },
    orderBy: { sendAt: "asc" },
    take: 30,
  });

  let sent = 0, failed = 0, skipped = 0;
  const startedAt = Date.now();

  for (const msg of due) {
    const waitMs = msg.sendAt.getTime() - Date.now();
    if (waitMs > 0) {
      // Estourou o orçamento → deixa PENDING pra próxima rodada.
      if (Date.now() - startedAt + waitMs > WAIT_BUDGET_MS) break;
      await new Promise((r) => setTimeout(r, waitMs));
    }
    // Claim atômico — só processa se ainda estiver PENDING (cancelamento
    // durante a espera é respeitado).
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

      const hasImage = !!msg.mediaBase64 && !!msg.mediaType;
      const sendResult = hasImage
        ? await evolutionSendMedia(
            instance.instanceName,
            msg.phone,
            {
              media: msg.mediaBase64!,
              mediatype: "image",
              mimetype: msg.mediaType!,
              caption: msg.body || null,
              fileName: null,
            },
            (instance as any).instanceToken ?? null,
          )
        : await evolutionSendText(
            instance.instanceName,
            msg.phone,
            msg.body,
            (instance as any).instanceToken ?? null
          );
      // Texto do histórico: legenda ou o mesmo placeholder do envio pelo painel
      const storedBody = msg.body || (hasImage ? "[imagem]" : "");
      const externalId: string = sendResult?.key?.id ?? sendResult?.id ?? `out-${Date.now()}-${msg.id.slice(-6)}`;

      const conv = await upsertConversation({
        companyId: msg.companyId,
        phone: msg.phone,
        direction: "OUTBOUND",
        body: storedBody,
        instanceId: instance.id,
      });
      // Agendada MANUAL (atendente) → sai com o nome de quem agendou e NÃO é
      // marcada como agente de IA (senão cai no filtro "IA atendeu" e no balão
      // teal). Demais kinds (lembretes do agente) seguem como IA.
      const isManual = msg.kind === "manual";
      const manualUserId = isManual ? ((msg.meta as any)?.userId ?? null) : null;
      await prisma.message.create({
        data: {
          externalId,
          body: storedBody,
          ...(hasImage ? { mediaBase64: msg.mediaBase64, mediaType: msg.mediaType } : {}),
          direction: "OUTBOUND",
          phone: msg.phone,
          instanceId: instance.id,
          companyId: msg.companyId,
          conversationId: conv.id,
          ack: 1,
          ...(isManual
            ? { sentByUserId: manualUserId }
            : { sentByAI: true }),
          rawPayload: isManual
            ? ({ scheduled: true, scheduledMessageId: msg.id } as any)
            : ({ autoAgent: true, scheduled: true, scheduledMessageId: msg.id } as any),
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
