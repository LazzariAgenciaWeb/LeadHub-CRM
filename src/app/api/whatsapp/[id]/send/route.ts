import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionSendText, evolutionSendMedia } from "@/lib/evolution";
import { upsertConversation } from "@/lib/whatsapp";
import { assertModule } from "@/lib/billing";
import { enforceSendGuards, releaseQuota } from "@/lib/whatsapp-guard";

// POST /api/whatsapp/[id]/send
// Body: { phone: string, text: string }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // fix A3 — gate de módulo whatsapp
  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const instance = await prisma.whatsappInstance.findUnique({
    where: { id },
    include: { company: { select: { modoAtendimento: true } } },
  });
  if (!instance) return NextResponse.json({ error: "Instância não encontrada" }, { status: 404 });

  if (userRole !== "SUPER_ADMIN" && instance.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  // Gate de modo: em VISAO a empresa não envia mensagens pelo painel.
  // SUPER_ADMIN passa (admin do sistema fazendo manutenção/troubleshoot).
  if (userRole !== "SUPER_ADMIN" && instance.company?.modoAtendimento === "VISAO") {
    return NextResponse.json(
      { error: "Empresa em modo Visão (somente leitura). Envie pelo WhatsApp do celular." },
      { status: 403 }
    );
  }

  const userId = (session.user as any).id as string | undefined;
  const {
    phone,
    text,
    quotedExternalId,
    quotedBody,
    quotedFromMe,
    // Mídia opcional. Quando presente, `text` vira caption.
    media,            // base64 puro (sem prefixo data:...) — ou com prefixo, o helper limpa
    mediaMimeType,    // ex: "image/jpeg"
    mediaType,        // "image" | "video" | "document" (default "image")
    fileName,         // só usado pra mediaType="document"
  } = await req.json();

  const hasMedia = typeof media === "string" && media.length > 0 && typeof mediaMimeType === "string";
  if (!phone) {
    return NextResponse.json({ error: "phone é obrigatório" }, { status: 400 });
  }
  if (!hasMedia && !text) {
    return NextResponse.json({ error: "text é obrigatório quando não há mídia" }, { status: 400 });
  }

  const quoted = quotedExternalId
    ? { externalId: quotedExternalId, body: quotedBody ?? "", fromMe: quotedFromMe ?? false }
    : null;

  // fix 7a/7b/7c — defesas anti-banimento (throttle, limite diário, cold msg)
  const guard = await enforceSendGuards({
    instanceId:        id,
    instanceCreatedAt: instance.createdAt,
    companyId:         instance.companyId,
    phone,
    userRole,
  });
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  try {
    const instanceToken = (instance as any).instanceToken as string | null | undefined;
    const result = hasMedia
      ? await evolutionSendMedia(
          instance.instanceName,
          phone,
          {
            media,
            mediatype: (mediaType === "video" || mediaType === "document" ? mediaType : "image") as
              | "image"
              | "video"
              | "document",
            mimetype: mediaMimeType,
            caption: text || null,
            fileName: fileName ?? null,
          },
          instanceToken,
          quoted
        )
      : await evolutionSendText(instance.instanceName, phone, text, instanceToken, quoted);

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

    // Texto a salvar no Message.body — caption se houver; senão um placeholder
    // descritivo conforme o tipo de mídia (mesma convenção da recepção via webhook).
    const placeholder = hasMedia
      ? (mediaType === "video" ? "[vídeo]" : mediaType === "document" ? "[documento]" : "[imagem]")
      : "";
    const bodyToStore = text || placeholder;

    // Upsert da Conversation — fonte da verdade do status de atendimento
    const conv = await upsertConversation({
      companyId: instance.companyId,
      phone: phoneForStorage,
      direction: "OUTBOUND",
      body: bodyToStore,
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
        body: bodyToStore,
        direction: "OUTBOUND",
        phone: phoneForStorage,
        instanceId: id,
        companyId: instance.companyId,
        conversationId: conv.id,
        ack: 1,
        sentByUserId: userId ?? null,
        ...(hasMedia
          ? {
              // Mesma convenção da recepção: base64 puro (sem prefixo data:) no DB.
              // É servido por /api/whatsapp/messages/[id]/media com Content-Type.
              mediaBase64: media.replace(/^data:[^;]+;base64,/, ""),
              mediaType: mediaMimeType,
            }
          : {}),
        ...(quoted ? { quotedId: quotedExternalId, quotedBody: quotedBody ?? null } : {}),
      },
      include: { instance: { select: { instanceName: true } }, campaign: { select: { id: true, name: true } } },
    });

    // Gamificação — NÃO roda mais aqui. Toda pontuação ligada a mensagens
    // (resposta rápida, primeira resposta, ajuda exército, badges de grupo,
    // easter eggs noturnos) é processada em batch pelo cron diário
    // (runDailyMessageScoring) — evita sobrecarregar o banco a cada mensagem
    // enviada e garante 1 evento por (user, dia) ao invés de N por turno.

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

    // Strip mediaBase64 da resposta (pode ser >500KB) e expõe `hasMedia: true`
    // pro front renderizar via /api/whatsapp/messages/[id]/media — mesmo padrão
    // do listing e do ticket endpoint.
    const { mediaBase64: _drop, ...rest } = saved as any;
    return NextResponse.json({ ok: true, message: { ...rest, hasMedia: !!_drop } });
  } catch (err: any) {
    // fix 7b — devolve a quota consumida quando a Evolution falha; o limite
    // diário só conta sucessos, evitando "queimar" envios pra cliente com
    // problema de conectividade.
    await releaseQuota(id);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
