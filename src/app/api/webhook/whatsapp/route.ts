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

    // Processar apenas mensagens recebidas
    // A Evolution pode enviar como "messages.upsert" ou "MESSAGES_UPSERT" (webhookByEvents=true)
    const normalizedEvent = event.toLowerCase().replace(/_/g, ".");
    if (normalizedEvent !== "messages.upsert") {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const message = data?.message;
    const key = data?.key;
    const fromMe = key?.fromMe === true;

    // Extrair telefone do contato (sempre o remoteJid)
    const rawPhone = key?.remoteJid ?? "";
    const phone = rawPhone.replace("@s.whatsapp.net", "").replace("@g.us", "");

    // Nome do contato no WhatsApp (pushName vem da Evolution API)
    const contactName: string | null = data?.pushName ?? data?.verifiedBizName ?? null;

    if (!phone || rawPhone.includes("@g.us")) {
      // Ignorar mensagens de grupos por enquanto
      return NextResponse.json({ ok: true, skipped: "group" });
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
              body: body_text,
              direction: "OUTBOUND",
              processed: true,
              rawPayload: body,
              companyId: waInstance.companyId,
              instanceId: waInstance.id,
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
