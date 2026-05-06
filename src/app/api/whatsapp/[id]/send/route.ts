import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionSendText } from "@/lib/evolution";
import { upsertConversation } from "@/lib/whatsapp";
import { addScore, addScoreOnce } from "@/lib/gamification";
import { businessMinutesBetween } from "@/lib/business-hours";
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

    // Snapshot da conversa ANTES do upsert — pra detectar primeira resposta + colaboração.
    // Aplica pra grupos também: o admin pode marcar grupos internos como
    // excludeFromGamification pra eles não pontuarem.
    const convBefore = await prisma.conversation.findUnique({
      where: { companyId_phone: { companyId: instance.companyId, phone: phoneForStorage } },
      select: {
        firstResponseAt: true, createdAt: true, assigneeId: true,
        lastMessageAt: true, lastMessageDirection: true,
        excludeFromGamification: true,
      },
    }).catch(() => null);

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

    // Gamificação — TODAS as métricas usam idempotência POR DIA pra evitar
    // sobrecarregar com cada mensagem. Atendimento, mesmo com várias
    // mensagens trocadas, gera no máximo 1 evento de cada tipo por
    // (conv, user, dia). O peso da pontuação fica concentrado no
    // primeiro turno do dia, o resto é ruído.
    //
    //  1. Resposta rápida — minutos úteis desde a última INBOUND. Idempotente
    //     por (conv, user, dia) — só conta a primeira do dia.
    //  2. Colaboração / ajuda mútua: GUARDIÃO (sem assignee) ou EXÉRCITO
    //     (assignee é outro). Idempotente por (conv, user, dia).
    //  3. Grupos: DIPLOMATA (1ª vez ever no grupo), PRECISO (≤5min, idempotente
    //     por dia), NETWORK (semanal, com early-skip pra evitar query pesada).
    //  4. Easter eggs: Coruja (após 22h) e Madrugador (antes 7h)
    //
    // Conversas marcadas com excludeFromGamification (grupos internos) NÃO
    // pontuam — o admin liga isso na UI.
    if (userId && convBefore && !convBefore.excludeFromGamification) {
      const customerWaiting = convBefore.lastMessageDirection === "INBOUND";
      const dayKey = new Date().toISOString().slice(0, 10);

      // 1. Resposta rápida — só conta se cliente acabou de mandar algo.
      //    Idempotente por (conv, user, dia, faixa) — uma vez por dia por
      //    conversa por user. Evita gerar evento a cada nova mensagem.
      if (customerWaiting && convBefore.lastMessageAt) {
        const mins = businessMinutesBetween(convBefore.lastMessageAt, new Date());
        const reason = mins <= 5 ? "RESPOSTA_RAPIDA_5MIN" : mins <= 30 ? "RESPOSTA_RAPIDA_30MIN" : null;
        if (reason) {
          void addScoreOnce(
            userId, instance.companyId, reason,
            `${conv.id}:${userId}:${dayKey}:${reason}`,
          ).catch(() => {});
        }
      }

      // 2. Colaboração — só faz sentido se a última mensagem foi do cliente
      if (customerWaiting) {
        if (!convBefore.assigneeId) {
          void addScoreOnce(
            userId, instance.companyId, "PRIMEIRA_RESPOSTA",
            `${conv.id}:${userId}:${dayKey}:guardiao`,
          ).catch(() => {});
        } else if (convBefore.assigneeId !== userId) {
          void addScoreOnce(
            userId, instance.companyId, "AJUDA_EXERCITO",
            `${conv.id}:${userId}:${dayKey}:exercito`,
          ).catch(() => {});
        }
      }

      // ── Badges de grupo ──────────────────────────────────────────────
      const isGroup = phoneForStorage.includes("@g.us");
      if (isGroup) {
        // DIPLOMATA: primeira vez que esse user responde NESTE grupo
        void addScoreOnce(
          userId, instance.companyId, "ATENDIMENTO_GRUPO_NOVO",
          `${conv.id}:${userId}:diplomata`,
        ).catch(() => {});

        // PRECISO: resposta rápida em grupo. Idempotente por (conv, user, dia)
        // — só conta a primeira do dia, mesmo que cliente mande várias mensagens.
        if (customerWaiting && convBefore.lastMessageAt) {
          const mins = businessMinutesBetween(convBefore.lastMessageAt, new Date());
          if (mins <= 5) {
            void addScoreOnce(
              userId, instance.companyId, "RESPOSTA_RAPIDA_GRUPO",
              `${conv.id}:${userId}:${dayKey}:preciso`,
            ).catch(() => {});
          }
        }

        // NETWORK: semanal. Antes de rodar a query pesada de "abandonados",
        // checa se já ganhou a semana. Se sim, pula tudo — evita query a cada
        // mensagem em grupo.
        const weekStart = (() => {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          const diff = d.getDay() === 0 ? 6 : d.getDay() - 1;
          d.setDate(d.getDate() - diff);
          return d;
        })();
        const networkRefKey = `${userId}:${weekStart.toISOString().slice(0, 10)}:network`;
        const networkExists = await prisma.scoreEvent.findFirst({
          where: { userId, reason: "DIA_NETWORK", referenceId: networkRefKey },
          select: { id: true },
        });
        if (!networkExists) {
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const abandonados = await prisma.conversation.count({
            where: {
              companyId:            instance.companyId,
              assigneeId:           userId,
              phone:                { contains: "@g.us" },
              excludeFromGamification: false,
              lastMessageDirection: "INBOUND",
              lastMessageAt:        { lte: oneDayAgo },
              status:               { notIn: ["CLOSED"] },
            },
          });
          if (abandonados === 0) {
            void addScoreOnce(userId, instance.companyId, "DIA_NETWORK", networkRefKey).catch(() => {});
          }
        }
      }

      // 4. Easter eggs por horário — idempotente por (user, dia)
      const hour = new Date().getHours();
      if (hour >= 22 || hour < 5) {
        void addScoreOnce(userId, instance.companyId, "BONUS_NOITE", `${userId}:${dayKey}:noite`).catch(() => {});
      } else if (hour < 7) {
        void addScoreOnce(userId, instance.companyId, "BONUS_MADRUGADA", `${userId}:${dayKey}:madrugada`).catch(() => {});
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
    // fix 7b — devolve a quota consumida quando a Evolution falha; o limite
    // diário só conta sucessos, evitando "queimar" envios pra cliente com
    // problema de conectividade.
    await releaseQuota(id);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
