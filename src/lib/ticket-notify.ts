import { prisma } from "./prisma";
import { evolutionSendText } from "./evolution";
import { upsertConversation, resolveOwnExternalId } from "./whatsapp";

// Notifica o cliente no WhatsApp quando o chamado que ele acompanha muda
// pra status final (RESOLVED/CLOSED). Fire-and-forget: erros são logados,
// não bloqueiam o PATCH do chamado.
//
// Só dispara quando o PATCH chamador identifica:
//   - ticket.phone existe (chamado tem WhatsApp vinculado)
//   - ticket.publicToken existe (cliente optou por acompanhar)
//   - transição real de status pra RESOLVED/CLOSED (não reenvia se já estava)
//
// Escolhe a instância pela Conversation.instanceId do phone; fallback: primeira
// WhatsappInstance ativa da empresa. Grava Message pra aparecer no histórico
// da conversa (mesma convenção do endpoint /api/whatsapp/[id]/send).
export async function notifyClientOnTicketClose(args: {
  ticketId:    string;
  companyId:   string;
  phone:       string;
  title:       string;
  status:      "RESOLVED" | "CLOSED";
  publicToken: string;
  userId?:     string | null;
}): Promise<{ sent: boolean; reason?: string }> {
  const { ticketId, companyId, phone, title, status, publicToken, userId } = args;

  try {
    const conv = await prisma.conversation.findFirst({
      where:   { phone, companyId },
      select:  { id: true, instanceId: true },
      orderBy: { updatedAt: "desc" },
    });

    let instanceId = conv?.instanceId ?? null;
    if (!instanceId) {
      const fallback = await prisma.whatsappInstance.findFirst({
        where:   { companyId },
        select:  { id: true },
        orderBy: { createdAt: "asc" },
      });
      instanceId = fallback?.id ?? null;
    }
    if (!instanceId) return { sent: false, reason: "sem instância WhatsApp na empresa" };

    const instance = await prisma.whatsappInstance.findUnique({
      where:  { id: instanceId },
      select: { instanceName: true, instanceToken: true },
    });
    if (!instance) return { sent: false, reason: "instância não encontrada" };

    const baseUrl = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
    const link = baseUrl ? `${baseUrl}/acompanhar/${publicToken}` : `/acompanhar/${publicToken}`;
    const verbo = status === "RESOLVED" ? "resolvido" : "encerrado";
    const text =
      `✅ Seu chamado *${title}* foi ${verbo}.\n\n` +
      `Se precisar rever o histórico ou reabrir, acompanhe por aqui:\n${link}`;

    const result = await evolutionSendText(
      instance.instanceName,
      phone,
      text,
      instance.instanceToken ?? null,
    );

    const externalId: string =
      (result as any)?.key?.id ?? (result as any)?.id ?? `out-${Date.now()}`;

    const convRef = conv ?? await upsertConversation({
      companyId, phone, direction: "OUTBOUND", body: text, instanceId,
    });

    await prisma.message.create({
      data: {
        externalId:     await resolveOwnExternalId(externalId, companyId),
        body:           text,
        direction:      "OUTBOUND",
        phone,
        instanceId,
        companyId,
        conversationId: convRef.id,
        ack:            1,
        sentByUserId:   userId ?? null,
      },
    }).catch((err) => {
      console.error("[TicketNotify] falha ao gravar Message local", err);
    });

    await prisma.activity.create({
      data: {
        type: "VALUE_CHANGED",
        body: `Cliente avisado no WhatsApp: chamado ${verbo}`,
        meta: { field: "notifyOnClose", channel: "whatsapp", status },
        authorId: userId ?? null,
        authorName: "Sistema",
        ticketId,
        companyId,
      },
    }).catch(() => { /* não crítico */ });

    return { sent: true };
  } catch (err) {
    console.error("[TicketNotify] falhou", err);
    return { sent: false, reason: (err as Error)?.message ?? "erro" };
  }
}
