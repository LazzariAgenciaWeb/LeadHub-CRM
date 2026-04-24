import { NextRequest, NextResponse } from "next/server";
import { processInboundMessage } from "@/lib/whatsapp";

/**
 * POST /api/webhook/whatsapp
 *
 * Recebe eventos da Evolution API.
 * Configure este endpoint na sua instância da Evolution API.
 * URL: https://seu-dominio.com/api/webhook/whatsapp
 *
 * Eventos suportados:
 *   - messages.upsert (mensagem recebida)
 */
// Armazena os últimos 5 payloads recebidos para diagnóstico
const recentPayloads: { ts: string; event: string; instance: string; skipped?: string }[] = [];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Estrutura padrão da Evolution API
    const event = body?.event;
    const instance = body?.instance;
    const data = body?.data;

    // Log para diagnóstico
    console.log("[Webhook WA] Recebido:", JSON.stringify({ event, instance, hasData: !!data }));
    recentPayloads.unshift({ ts: new Date().toISOString(), event: event ?? "?", instance: instance ?? "?" });
    if (recentPayloads.length > 5) recentPayloads.pop();

    if (!event || !instance || !data) {
      return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });
    }

    const normalizedEvent = event.toLowerCase().replace(/_/g, ".");

    // CONNECTION_UPDATE → salvar telefone da instância quando conecta
    if (normalizedEvent === "connection.update") {
      const state = data?.state ?? data?.instance?.state;
      if (state === "open") {
        // Evolution v2 envia me.id = "5511999@s.whatsapp.net"
        const meId: string | undefined = data?.me?.id ?? data?.instance?.owner;
        if (meId) {
          const phone = meId.replace("@s.whatsapp.net", "").replace(/\D/g, "");
          await (await import("@/lib/prisma")).prisma.whatsappInstance.updateMany({
            where: { instanceName: instance },
            data: { phone },
          });
          console.log(`[Webhook WA] Instância ${instance} conectada com phone=${phone}`);
        }
      }
      return NextResponse.json({ ok: true, skipped: "connection_update" });
    }

    // ── MESSAGES_UPDATE → atualizar ACK (entregue / lido) ───────────────────
    if (normalizedEvent === "messages.update") {
      const { prisma } = await import("@/lib/prisma");
      const updates: any[] = Array.isArray(data) ? data : (data ? [data] : []);
      for (const item of updates) {
        const msgId: string | undefined = item?.key?.id;
        const rawAck = item?.update?.status;
        if (!msgId || rawAck === undefined) continue;

        // Normaliza ACK para inteiro (Evolution pode enviar string ou número)
        const ACK_MAP: Record<string, number> = {
          ERROR: -1, PENDING: 0, SERVER_ACK: 1, DELIVERY_ACK: 2, READ: 3, PLAYED: 4,
        };
        const ackInt: number | null =
          typeof rawAck === "number" ? rawAck :
          typeof rawAck === "string" ? (ACK_MAP[rawAck] ?? null) : null;

        if (ackInt !== null) {
          await prisma.message.updateMany({
            where: { externalId: msgId },
            data: { ack: ackInt },
          });
        }
      }
      return NextResponse.json({ ok: true, event: "messages.update" });
    }

    // Processar apenas mensagens recebidas
    // A Evolution pode enviar como "messages.upsert" ou "MESSAGES_UPSERT" (webhookByEvents=true)
    if (normalizedEvent !== "messages.upsert") {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const message = data?.message;
    const key = data?.key;
    const fromMe = key?.fromMe === true;

    // Timestamp real da mensagem (segundos → ms); fallback: agora
    const receivedAt = data?.messageTimestamp
      ? new Date(Number(data.messageTimestamp) * 1000)
      : new Date();

    // Citação: verifica contextInfo dentro das mensagens que suportam isso
    const contextInfo =
      message?.extendedTextMessage?.contextInfo ??
      message?.imageMessage?.contextInfo ??
      message?.videoMessage?.contextInfo ??
      message?.documentMessage?.contextInfo ??
      message?.audioMessage?.contextInfo ??
      message?.stickerMessage?.contextInfo ??
      null;
    const quotedId: string | null = contextInfo?.stanzaId ?? null;
    const quotedBody: string | null = contextInfo?.quotedMessage
      ? (contextInfo.quotedMessage.conversation ??
         contextInfo.quotedMessage.extendedTextMessage?.text ??
         contextInfo.quotedMessage.imageMessage?.caption ??
         contextInfo.quotedMessage.videoMessage?.caption ??
         "📎 Mídia")
      : null;

    // Extrair telefone do contato (sempre o remoteJid)
    const rawPhone = key?.remoteJid ?? "";
    const isGroup = rawPhone.includes("@g.us");

    // Para grupos: manter o JID completo como identificador; para individuais: só dígitos
    const phone = isGroup
      ? rawPhone                                              // "120363...@g.us"
      : rawPhone.replace("@s.whatsapp.net", "").replace(/\D/g, "");

    // Quem enviou dentro do grupo (participante)
    const participantPhone: string | null = isGroup
      ? (data?.participant ?? key?.participant ?? null)
      : null;

    // Nome do contato no WhatsApp (pushName vem da Evolution API)
    // Para mensagens individuais: nome do contato que enviou
    // Para mensagens de grupo: nome do participante que enviou a mensagem
    const contactName: string | null = data?.pushName ?? data?.verifiedBizName ?? null;
    const participantName: string | null = isGroup ? (data?.pushName ?? null) : null;

    if (!phone) {
      return NextResponse.json({ ok: true, skipped: "no_phone" });
    }

    // Detectar tipo de mídia quando não há texto puro
    function resolveBodyText(msg: any): string {
      // Texto puro
      if (msg?.conversation) return msg.conversation;
      if (msg?.extendedTextMessage?.text) return msg.extendedTextMessage.text;

      // Mídia com legenda
      if (msg?.imageMessage?.caption) return msg.imageMessage.caption;
      if (msg?.videoMessage?.caption) return msg.videoMessage.caption;
      if (msg?.documentMessage?.caption) return msg.documentMessage.caption;

      // Mídia sem legenda — descritores amigáveis
      if (msg?.audioMessage) return "🎵 Áudio";
      if (msg?.pttMessage) return "🎤 Áudio";
      if (msg?.imageMessage) return "🖼️ Imagem";
      if (msg?.videoMessage) return "🎥 Vídeo";
      if (msg?.documentMessage) {
        const name = msg.documentMessage.fileName ?? "Arquivo";
        return `📎 ${name}`;
      }
      if (msg?.stickerMessage) return "😄 Figurinha";
      if (msg?.locationMessage) {
        const { degreesLatitude: lat, degreesLongitude: lng } = msg.locationMessage;
        return lat != null ? `📍 Localização (${lat.toFixed(4)}, ${lng.toFixed(4)})` : "📍 Localização";
      }
      if (msg?.contactMessage) {
        const name = msg.contactMessage.displayName ?? "Contato";
        return `👤 Contato: ${name}`;
      }
      if (msg?.reactionMessage) return ""; // ignorar reações silenciosamente

      return "";
    }

    const body_text = resolveBodyText(message);

    if (!body_text) {
      return NextResponse.json({ ok: true, skipped: "no_text" });
    }

    // Mensagem enviada pelo celular da instância (fromMe=true) → salvar como OUTBOUND
    if (fromMe) {
      const { prisma } = await import("@/lib/prisma");
      const waInstance = await prisma.whatsappInstance.findFirst({
        where: { instanceName: instance },
      });
      if (waInstance && key?.id) {
        // Evitar duplicatas checando se já existe
        const exists = await prisma.message.findUnique({ where: { externalId: key.id } });
        if (!exists) {
          await prisma.message.create({
            data: {
              externalId: key.id,
              phone,
              participantPhone: isGroup ? (data?.participant ?? key?.participant ?? undefined) : undefined,
              participantName: isGroup ? (data?.pushName ?? undefined) : undefined,
              body: body_text,
              direction: "OUTBOUND",
              processed: true,
              rawPayload: body,
              receivedAt,
              companyId: waInstance.companyId,
              instanceId: waInstance.id,
              ...(quotedId ? { quotedId, quotedBody } : {}),
            },
          });
        }
      }
      return NextResponse.json({ ok: true, saved: "outbound" });
    }

    const result = await processInboundMessage({
      instanceName: instance,
      phone,
      body: body_text,
      externalId: key?.id,
      rawPayload: body,
      contactName,
      participantPhone,
      participantName,
      receivedAt,
      quotedId,
      quotedBody,
    });

    return NextResponse.json({
      ok: true,
      leadId: result?.lead?.id,
      identifiedAs: result?.identifiedAs,
    });
  } catch (error) {
    console.error("[Webhook WA] Erro:", error);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}

// A Evolution API pode fazer um GET para verificar o webhook
// Também retorna os últimos payloads recebidos para diagnóstico
export async function GET() {
  return NextResponse.json({ ok: true, service: "LeadHub Webhook", recentPayloads });
}
