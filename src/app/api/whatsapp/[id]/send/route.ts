import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionSendText } from "@/lib/evolution";
import { upsertConversation } from "@/lib/whatsapp";
import { addScore } from "@/lib/gamification";
import { businessMinutesBetween } from "@/lib/business-hours";

// POST /api/whatsapp/[id]/send
// Body: { phone: string, text: string }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const instance = await prisma.whatsappInstance.findUnique({ where: { id } });
  if (!instance) return NextResponse.json({ error: "Instância não encontrada" }, { status: 404 });

  if (userRole !== "SUPER_ADMIN" && instance.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const userId = (session.user as any).id as string | undefined;
  const { phone, text, quotedExternalId, quotedBody, quotedFromMe } = await req.json();
  if (!phone || !text) {
    return NextResponse.json({ error: "phone e text são obrigatórios" }, { status: 400 });
  }

  const quoted = quotedExternalId
    ? { externalId: quotedExternalId, body: quotedBody ?? "", fromMe: quotedFromMe ?? false }
    : null;

  try {
    const instanceToken = (instance as any).instanceToken as string | null | undefined;
    const result = await evolutionSendText(instance.instanceName, phone, text, instanceToken, quoted);

    // Extrair externalId do retorno da Evolution (múltiplos paths por segurança)
    const externalId: string =
      result?.key?.id ??
      result?.id ??
      `out-${Date.now()}`;

    console.log(`[Send] externalId=${externalId} result.key.id=${result?.key?.id} result.id=${result?.id}`);

    // Phone para salvar a mensagem: usar o phone da conversa (parâmetro recebido) para manter
    // consistência com as demais mensagens do histórico.
    // canonicalPhone (do remoteJid da Evolution) é usado apenas para lookup de lead, pois pode
    // ter formato diferente (com/sem DDI 55) do que está armazenado no banco.
    // @lid = identificador anônimo do WhatsApp Business — manter JID inteiro, não extrair dígitos.
    const rawJid: string | undefined = result?.key?.remoteJid;
    const canonicalPhone =
      rawJid && !rawJid.includes("@g.us") && !rawJid.includes("@lid")
        ? rawJid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
        : phone;

    // Para salvar a mensagem: manter o phone original (formato da conversa no banco)
    // Exceção: nova conversa sem histórico → usar canonicalPhone para ter o formato
    // que a Evolution usará nas mensagens inbound (evita conversa duplicada).
    const existingCount = (phone.includes("@g.us") || phone.includes("@lid")) ? 1 : await prisma.message.count({
      where: { phone, companyId: instance.companyId },
    });
    const phoneForStorage = existingCount > 0 ? phone : canonicalPhone;

    // Snapshot da conversa ANTES do upsert — para detectar se esta é a primeira resposta
    const convBefore = !phone.includes("@g.us") && !phone.includes("@lid")
      ? await prisma.conversation.findUnique({
          where: { companyId_phone: { companyId: instance.companyId, phone: phoneForStorage } },
          select: { firstResponseAt: true, createdAt: true },
        }).catch(() => null)
      : null;

    // Upsert da Conversation — fonte da verdade do status de atendimento
    const conv = await upsertConversation({
      companyId: instance.companyId,
      phone: phoneForStorage,
      direction: "OUTBOUND",
      body: text,
      instanceId: id,
    });

    // Save the sent message locally.
    // ack=1 (SERVER_ACK): a Evolution já confirmou que recebeu — mensagem está ao menos
    // no servidor. O webhook MESSAGES_UPDATE depois eleva pra 2 (entregue) e 3 (lido).
    // Pendente (ack=0) só faria sentido se a chamada acima tivesse falhado, e nesse caso
    // entraríamos no catch.
    const saved = await prisma.message.create({
      data: {
        externalId,
        body: text,
        direction: "OUTBOUND",
        phone: phoneForStorage,
        instanceId: id,
        companyId: instance.companyId,
        conversationId: conv.id,
        ack: 1,
        ...(quoted ? { quotedId: quotedExternalId, quotedBody: quotedBody ?? null } : {}),
      },
      include: { instance: { select: { instanceName: true } }, campaign: { select: { id: true, name: true } } },
    });

    // Gamificação: pontua resposta rápida se esta for a primeira resposta do atendente
    if (userId && convBefore && !convBefore.firstResponseAt) {
      const mins = businessMinutesBetween(convBefore.createdAt, new Date());
      const reason = mins <= 5 ? "RESPOSTA_RAPIDA_5MIN" : mins <= 30 ? "RESPOSTA_RAPIDA_30MIN" : null;
      if (reason) {
        void addScore(userId, instance.companyId, reason, conv.id).catch(() => {});
      }
    }

    // Para grupos e @lid não há lead vinculado — pular atualização de atendimento
    if (!canonicalPhone.includes("@g.us") && !canonicalPhone.includes("@lid")) {
      // Vincula o lead à conversa (se existir e ainda não estiver vinculado)
      const lead = await prisma.lead.findFirst({
        where: { phone: { in: [phone, canonicalPhone] }, companyId: instance.companyId },
        orderBy: { createdAt: "desc" },
      });
      if (lead && lead.conversationId !== conv.id) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { conversationId: conv.id },
        }).catch(() => {/* não crítico */});
      }
    }

    return NextResponse.json({ ok: true, message: saved });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
