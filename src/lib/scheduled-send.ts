import { prisma } from "./prisma";
import { evolutionSendText, evolutionSendMedia } from "./evolution";
import { upsertConversation } from "./whatsapp";

/**
 * Envia UMA ScheduledMessage agora (Evolution) e grava na conversa.
 *
 * Usado pelo cron /api/cron/scheduled-messages e por quem precisa disparar na
 * hora sem esperar a próxima rodada (ex.: "Enviar pra aprovação"). Gravar a
 * mensagem na fila antes de enviar deixa o rastro mesmo se o envio falhar.
 *
 * Idempotência: claim atômico PENDING → SENDING. Duas chamadas simultâneas
 * não duplicam envio; a segunda volta "skipped".
 */
export async function deliverScheduledMessage(id: string): Promise<"sent" | "failed" | "skipped"> {
  const claimed = await prisma.scheduledMessage.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "SENDING" },
  });
  if (claimed.count === 0) return "skipped";

  const msg = await prisma.scheduledMessage.findUnique({ where: { id } });
  if (!msg) return "skipped";

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
    // Agendada MANUAL (atendente) ou de aprovação de peça → sai com o nome de
    // quem disparou (ou sem autor, no lembrete automático) e NÃO é marcada como
    // agente de IA (senão cai no filtro "IA atendeu" e no balão teal). Demais
    // kinds (lembretes do agente) seguem como IA.
    const isManual = msg.kind === "manual" || !!msg.kind?.startsWith("approval");
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
    return "sent";
  } catch (err: any) {
    await prisma.scheduledMessage.update({
      where: { id: msg.id },
      data: { status: "FAILED", lastError: err?.message ?? String(err) },
    }).catch(() => {});
    console.error(`[ScheduledMessages] falha id=${msg.id}:`, err);
    return "failed";
  }
}
