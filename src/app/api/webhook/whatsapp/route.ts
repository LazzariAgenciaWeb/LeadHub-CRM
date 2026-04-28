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
// Armazena os últimos payloads para diagnóstico (separados por tipo)
const recentPayloads: { ts: string; event: string; instance: string; skipped?: string; debug?: any }[] = [];
const recentAckPayloads: { ts: string; instance: string; debug: any }[] = [];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Estrutura padrão da Evolution API
    const event = body?.event;
    const instance = body?.instance;
    const data = body?.data;

    // Log para diagnóstico — aparece nos logs do servidor independente de serverless
    const logPhone = data?.key?.remoteJid ?? data?.remoteJid ?? "?";
    const logFromMe = data?.key?.fromMe ?? "?";
    console.log(`[Webhook WA] event=${event} instance=${instance} phone=${logPhone} fromMe=${logFromMe}`);
    recentPayloads.unshift({ ts: new Date().toISOString(), event: event ?? "?", instance: instance ?? "?", debug: { phone: logPhone, fromMe: logFromMe } });
    if (recentPayloads.length > 5) recentPayloads.pop();

    if (!event || !instance || !data) {
      return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });
    }

    const normalizedEvent = event.toLowerCase().replace(/_/g, ".");

    // CONNECTION_UPDATE → salvar telefone + garantir webhook configurado
    if (normalizedEvent === "connection.update") {
      const state = data?.state ?? data?.instance?.state;
      if (state === "open") {
        const { prisma } = await import("@/lib/prisma");
        const { evolutionSetWebhookEvents } = await import("@/lib/evolution");

        // Salvar telefone da instância (vem em me.id = "5511999@s.whatsapp.net")
        // Só salva se for um JID pessoal válido (@s.whatsapp.net), nunca @g.us ou @lid
        const meId: string | undefined = data?.me?.id ?? data?.instance?.owner;
        if (meId && meId.includes("@s.whatsapp.net")) {
          const phone = meId.replace("@s.whatsapp.net", "").replace(/\D/g, "");
          // Valida: telefone real tem entre 10 e 15 dígitos (nunca um ID interno longo)
          if (phone.length >= 10 && phone.length <= 15) {
            await prisma.whatsappInstance.updateMany({
              where: { instanceName: instance },
              data: { phone, status: "CONNECTED" },
            });
            console.log(`[Webhook WA] Instância ${instance} conectada com phone=${phone}`);
          } else {
            console.warn(`[Webhook WA] meId inválido ignorado para ${instance}: ${meId} → digits="${phone}" (${phone.length} dígitos)`);
            // Marca como CONNECTED sem alterar o telefone
            await prisma.whatsappInstance.updateMany({
              where: { instanceName: instance },
              data: { status: "CONNECTED" },
            });
          }
        } else if (meId) {
          console.warn(`[Webhook WA] meId sem @s.whatsapp.net ignorado para ${instance}: ${meId}`);
          await prisma.whatsappInstance.updateMany({
            where: { instanceName: instance },
            data: { status: "CONNECTED" },
          });
        }

        // Configurar webhook automaticamente para garantir que eventos sejam enviados
        // (cobre casos de nova instância ou reconexão após troca de servidor)
        try {
          const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
          if (baseUrl) {
            const webhookUrl = `${baseUrl}/api/webhook/whatsapp`;
            // Buscar token da instância no banco
            const inst = await prisma.whatsappInstance.findFirst({
              where: { instanceName: instance },
              select: { instanceToken: true },
            });
            await evolutionSetWebhookEvents(instance, webhookUrl, (inst as any)?.instanceToken ?? null);
            console.log(`[Webhook WA] Webhook reconfigurado para ${instance} → ${webhookUrl}`);
          }
        } catch (webhookErr) {
          // Não bloqueia o fluxo — apenas loga
          console.warn(`[Webhook WA] Falha ao reconfigurar webhook de ${instance}:`, webhookErr);
        }
      }

      // Atualizar status para DISCONNECTED quando desconecta
      if (state === "close" || state === "connecting") {
        const { prisma } = await import("@/lib/prisma");
        await prisma.whatsappInstance.updateMany({
          where: { instanceName: instance },
          data: { status: state === "connecting" ? "CONNECTING" : "DISCONNECTED" },
        }).catch(() => {});
      }

      return NextResponse.json({ ok: true, event: "connection_update", state });
    }

    // ── MESSAGES_UPDATE → atualizar ACK (entregue / lido) ───────────────────
    if (normalizedEvent === "messages.update") {
      const { prisma } = await import("@/lib/prisma");
      const updates: any[] = Array.isArray(data) ? data : (data ? [data] : []);

      // Debug: armazena em array separado (não é sobrescrito por upserts de grupo)
      const debugItem = updates[0];
      recentAckPayloads.unshift({
        ts: new Date().toISOString(),
        instance,
        debug: {
          msgId: debugItem?.key?.id,
          rawAck: debugItem?.update?.status,
          fromMe: debugItem?.key?.fromMe,
          count: updates.length,
        },
      });
      if (recentAckPayloads.length > 10) recentAckPayloads.pop();

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
          const result = await prisma.message.updateMany({
            where: { externalId: msgId },
            data: { ack: ackInt },
          });
          console.log(`[ACK] msgId=${msgId} ack=${ackInt} updated=${result.count}`);
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
    // @lid = Linked Identity do WhatsApp Business (identificador anônimo, não é telefone real)
    const isLid = rawPhone.includes("@lid");

    // Para grupos e @lid: manter o JID completo como identificador; para individuais: só dígitos
    const phone = isGroup || isLid
      ? rawPhone                                              // "120363...@g.us" ou "276690...@lid"
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
        // 1. Verificar se o registro já existe pelo externalId real → não fazer nada
        const existing = await prisma.message.findUnique({ where: { externalId: key.id } });

        if (!existing) {
          // 2. Tentar encontrar um registro salvo com ID-fallback "out-*" para o mesmo phone+body
          //    (criado pelo send/route.ts quando Evolution não retornou o ID no momento do envio)
          const thirtySecsAgo = new Date(Date.now() - 30_000);
          const fallback = await prisma.message.findFirst({
            where: {
              companyId: waInstance.companyId,
              phone,
              body: body_text,
              direction: "OUTBOUND",
              externalId: { startsWith: "out-" },
              receivedAt: { gte: thirtySecsAgo },
            },
            orderBy: { receivedAt: "desc" },
          });

          if (fallback) {
            // Atualiza o ID fallback → ID real para que o ACK funcione corretamente
            await prisma.message.update({
              where: { id: fallback.id },
              data: { externalId: key.id },
            });
            console.log(`[WA fromMe] fallback externalId ${fallback.externalId} → ${key.id}`);
          } else {
            // Nenhum registro existente → criar (mensagem enviada pelo celular/outro cliente)
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
        // Se existing !== null → já foi salvo corretamente pelo send/route.ts → não tocar
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
  return NextResponse.json({ ok: true, service: "LeadHub Webhook", recentPayloads, recentAckPayloads });
}
