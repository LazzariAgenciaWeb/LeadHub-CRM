import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { ActivityType, ConversationStatus } from "@/generated/prisma";
import { mapConvStatusToLegacy } from "@/lib/whatsapp";
import { formatBrazilDateTime, formatBrazilDateTimeShort } from "@/lib/datetime";
import { addScore, addScoreOnce } from "@/lib/gamification";
import { assertModule } from "@/lib/billing";
import { SYSTEM_TIMEZONE } from "@/lib/business-hours";

// YYYY-MM-DD no fuso da empresa (default America/Sao_Paulo). Usado pra
// comparações "mesmo dia" sem depender do TZ do servidor (Docker = UTC).
function localDayKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: SYSTEM_TIMEZONE });
}

const VALID_STATUS: ConversationStatus[] = ["OPEN", "PENDING", "IN_PROGRESS", "WAITING_CUSTOMER", "SCHEDULED", "CLOSED"];

// PATCH /api/conversations/[id]
// Atualiza status, atribuição (assigneeId), setor.
// Body opcional: { status?, assigneeId?, setorId?, action? }
//   action: "take" → assigneeId = usuário atual + status = IN_PROGRESS
//   action: "close" → status = CLOSED + closedAt = now
//   action: "reopen" → status = OPEN + closedAt = null
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // fix A3 — gate de módulo whatsapp (Conversation faz parte da Inbox)
  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const userId   = (session.user as any)?.id as string;
  const userName = (session.user as any)?.name as string;
  const userRole = (session.user as any)?.role;
  const userCompanyId = (session.user as any)?.companyId;

  const conv = await prisma.conversation.findUnique({
    where: { id },
    select: { id: true, companyId: true, status: true, assigneeId: true, setorId: true, scheduledReturnAt: true, returnNote: true, createdAt: true, excludeFromGamification: true, lastMessageDirection: true, lastMessageAt: true },
  });
  if (!conv) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  if (userRole !== "SUPER_ADMIN" && conv.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const data: Record<string, any> = {};
  const activities: { type: ActivityType; body: string; meta?: any }[] = [];

  // Atalhos
  if (body.action === "take") {
    data.assigneeId = userId;
    data.status = "IN_PROGRESS";
    data.statusUpdatedAt = new Date();
    if (conv.assigneeId !== userId) {
      activities.push({ type: "ASSIGNEE_CHANGED", body: `${userName} pegou a conversa`, meta: { from: conv.assigneeId, to: userId } });
    }
    if (conv.status !== "IN_PROGRESS") {
      activities.push({ type: "STATUS_CHANGED", body: `Status: ${conv.status} → IN_PROGRESS`, meta: { from: conv.status, to: "IN_PROGRESS" } });
    }
  } else if (body.action === "close") {
    data.status = "CLOSED";
    data.closedAt = new Date();
    data.statusUpdatedAt = new Date();
    // Finalizar também CONCLUI o ciclo de IA: o agente esquece o histórico
    // anterior — se o contato voltar, começa um atendimento novo do zero.
    data.aiCycleResetAt = new Date();
    activities.push({ type: "CONVERSATION_CLOSED", body: `${userName} finalizou a conversa`, meta: { from: conv.status, to: "CLOSED" } });
  } else if (body.action === "concludeAi") {
    // Conclui SÓ o atendimento de IA (a conversa continua como está): zera o
    // contexto do agente e rearma o bot — a próxima mensagem inicia ciclo novo.
    data.aiCycleResetAt = new Date();
    data.aiMode = "ACTIVE";
    data.aiPausedAt = null;
    activities.push({
      type: "STATUS_CHANGED",
      body: `${userName} concluiu o atendimento de IA — próximo contato começa um ciclo novo`,
      meta: { aiCycleReset: true },
    });
  } else if (body.action === "reopen") {
    data.status = "OPEN";
    data.closedAt = null;
    data.statusUpdatedAt = new Date();
    activities.push({ type: "CONVERSATION_REOPENED", body: `${userName} reabriu a conversa`, meta: { from: conv.status, to: "OPEN" } });
  } else {
    // Atualização explícita
    if (typeof body.status === "string" && VALID_STATUS.includes(body.status)) {
      if (conv.status !== body.status) {
        data.status = body.status;
        data.statusUpdatedAt = new Date();
        if (body.status === "CLOSED") {
          data.closedAt = new Date();
          data.aiCycleResetAt = new Date(); // fechar = concluir o ciclo de IA
        }
        if (body.status === "OPEN" && conv.status === "CLOSED") data.closedAt = null;
        activities.push({ type: "STATUS_CHANGED", body: `Status: ${conv.status} → ${body.status}`, meta: { from: conv.status, to: body.status } });
      }
    }
    if ("assigneeId" in body) {
      const newAssignee: string | null = body.assigneeId || null;
      if (newAssignee !== conv.assigneeId) {
        data.assigneeId = newAssignee;
        activities.push({
          type: "ASSIGNEE_CHANGED",
          body: newAssignee ? "Atendente alterado" : "Atribuição removida",
          meta: { from: conv.assigneeId, to: newAssignee },
        });
      }
    }
    if ("setorId" in body) {
      const newSetor: string | null = body.setorId || null;
      if (newSetor !== conv.setorId) {
        data.setorId = newSetor;
        activities.push({
          type: "SECTOR_CHANGED",
          body: "Conversa transferida para outro setor",
          meta: { from: conv.setorId, to: newSetor },
        });
      }
    }
    // Agendamento de retorno
    if ("scheduledReturnAt" in body) {
      data.scheduledReturnAt = body.scheduledReturnAt ? new Date(body.scheduledReturnAt) : null;
    }
    if ("returnNote" in body) {
      data.returnNote = body.returnNote ?? null;
    }
    // Agente de IA autônomo — pausar/reativar o bot NESTA conversa.
    // "OFF" = desligado manual (não reativa nem quando a conversa reabre);
    // "ACTIVE" = volta a responder. PAUSED_HUMAN é estado interno (não setável).
    if ("aiMode" in body) {
      if (body.aiMode !== "ACTIVE" && body.aiMode !== "OFF") {
        return NextResponse.json({ error: "aiMode inválido (use ACTIVE ou OFF)" }, { status: 400 });
      }
      data.aiMode = body.aiMode;
      data.aiPausedAt = body.aiMode === "OFF" ? new Date() : null;
      activities.push({
        type: "STATUS_CHANGED",
        body: body.aiMode === "OFF" ? `${userName} desligou o agente de IA nesta conversa` : `${userName} reativou o agente de IA nesta conversa`,
        meta: { aiMode: body.aiMode },
      });
    }
    // Excluir/incluir conversa da gamificação — admin only.
    // Use case: grupos internos do time não devem gerar pontos.
    if ("excludeFromGamification" in body) {
      const canManageUsers = !!(session.user as any).permissions?.canManageUsers;
      const isAdmin = userRole === "SUPER_ADMIN" || userRole === "ADMIN" || canManageUsers;
      if (!isAdmin) {
        return NextResponse.json(
          { error: "Apenas admin pode alterar gamificação da conversa" },
          { status: 403 },
        );
      }
      data.excludeFromGamification = !!body.excludeFromGamification;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  const updated = await prisma.conversation.update({
    where: { id },
    data,
    select: {
      id: true, status: true, statusUpdatedAt: true, closedAt: true,
      assigneeId: true, assignee: { select: { id: true, name: true } },
      setorId: true,   setor:    { select: { id: true, name: true } },
      scheduledReturnAt: true, returnNote: true,
      aiMode: true, aiCycleResetAt: true,
    },
  });

  // Gamificação — fire-and-forget, nunca bloqueia a resposta. addScoreOnce
  // é idempotente: reabrir e fechar a conversa novamente NÃO duplica pontos.
  // Conversas marcadas como excludeFromGamification (grupos internos) não
  // pontuam — admin liga isso na UI.
  const skipGamification = conv.excludeFromGamification;
  if (!skipGamification && updated.status === "CLOSED" && conv.status !== "CLOSED") {
    const scorer = updated.assigneeId ?? userId;
    // Mesmo dia comparado no fuso da empresa (não no TZ do servidor) — evita
    // edge case quando servidor roda UTC e atendimento atravessa meia-noite local.
    const sameDay = localDayKey(conv.createdAt) === localDayKey(new Date());
    if (sameDay) {
      void addScoreOnce(scorer, conv.companyId, "ATENDIMENTO_MESMO_DIA", conv.id).catch(() => {});
    }
    // RETORNO_ANTECIPADO no close manual só vale se o cliente realmente voltou
    // antes do prazo (lastMessageDirection=INBOUND). Sem essa checagem o atendente
    // poderia agendar pra amanhã e fechar agora pra ganhar pontos.
    // Caso "feliz" (cliente respondeu enquanto SCHEDULED) já pontua em
    // upsertConversation — aqui é fallback pra quando atendente fecha após
    // o INBOUND mas antes do prazo agendado.
    const customerActuallyReturned =
      conv.lastMessageDirection === "INBOUND" &&
      !!conv.lastMessageAt &&
      !!conv.scheduledReturnAt &&
      conv.lastMessageAt < conv.scheduledReturnAt;
    if (customerActuallyReturned) {
      void addScoreOnce(scorer, conv.companyId, "RETORNO_ANTECIPADO", conv.id).catch(() => {});
    }
    // Bônus de colaboração: se quem fechou NÃO é o responsável da conversa,
    // ganha pontos de EXÉRCITO (ajudou a finalizar atendimento de colega).
    // Idempotente por (conv, userId, dia) — alinhado com a regra do envio.
    if (updated.assigneeId && updated.assigneeId !== userId) {
      const dayKey = localDayKey(new Date());
      void addScoreOnce(
        userId, conv.companyId, "AJUDA_EXERCITO",
        `${conv.id}:${userId}:${dayKey}:exercito`,
      ).catch(() => {});
    }
  }

  // Penalidade: empurrar scheduledReturnAt depois de já estar vencido.
  if (
    !skipGamification &&
    "scheduledReturnAt" in body &&
    conv.scheduledReturnAt && conv.scheduledReturnAt < new Date()
  ) {
    const scorer = updated.assigneeId ?? userId;
    void addScore(scorer, conv.companyId, "PRAZO_PRORROGADO", conv.id).catch(() => {});
  }

  // LÍDER — encaminhamento de conversa (assignee/setor) por usuário diferente
  // do destinatário. Idempotente por (conv.id, dayKey) pra evitar farming via
  // toggling: só uma pontuação por conversa por dia, não importa quantas
  // mudanças. Conta só quando o usuário está ativamente passando pra outro
  // (não quando é "take" pra si próprio).
  const assigneeChanged = data.assigneeId !== undefined && data.assigneeId !== conv.assigneeId;
  const setorChanged    = data.setorId    !== undefined && data.setorId    !== conv.setorId;
  const isHandoff = (assigneeChanged && data.assigneeId && data.assigneeId !== userId) || setorChanged;
  if (!skipGamification && isHandoff && conv.status !== "CLOSED") {
    const dayKey = new Date().toISOString().slice(0, 10);
    void addScoreOnce(
      userId, conv.companyId, "ENCAMINHAMENTO",
      `${conv.id}:${userId}:${dayKey}:lider`,
    ).catch(() => {});
  }

  if (activities.length > 0) {
    await prisma.activity.createMany({
      data: activities.map((a) => ({
        type: a.type,
        body: a.body,
        meta: a.meta ?? undefined,
        authorId: userId,
        authorName: userName,
        conversationId: conv.id,
        companyId: conv.companyId,
      })),
    }).catch(() => { /* não crítico */ });
  }

  // Cria nota visual no chat quando se agenda um retorno — fica como bolha
  // roxa centralizada (tipo Chatwoot) pra todo mundo que abrir a conversa
  // ver imediatamente que tem retorno marcado.
  //
  // Persiste em DOIS lugares:
  //  - ConversationNote (storage estruturado, histórico permanente, type=SCHEDULED)
  //  - Lead.notes (parser legado da timeline da inbox renderiza dali)
  // O marcador 📅 no início é detectado no front pra render em roxo.
  if (data.scheduledReturnAt && data.scheduledReturnAt instanceof Date) {
    const when = formatBrazilDateTime(data.scheduledReturnAt);
    const noteText = body.returnNote
      ? `📅 Retorno agendado para ${when} — ${body.returnNote}`
      : `📅 Retorno agendado para ${when}`;

    // ConversationNote + appends em Lead.notes em transação única — evita
    // bolha roxa aparecer na timeline estruturada mas não no parser legado
    // (ou vice-versa) se uma das escritas falhar.
    const legacyEntry = `[${formatBrazilDateTimeShort(new Date())}] ${noteText}`;
    const leads = await prisma.lead.findMany({
      where: { conversationId: conv.id },
      select: { id: true, notes: true },
    });
    await prisma.$transaction(async (tx) => {
      await tx.conversationNote.create({
        data: {
          conversationId: conv.id,
          body: noteText,
          type: "SCHEDULED",
          authorId: userId,
          authorName: userName,
        },
      });
      for (const l of leads) {
        await tx.lead.update({
          where: { id: l.id },
          data: { notes: l.notes ? `${legacyEntry}\n\n${l.notes}` : legacyEntry },
        });
      }
    }).catch(() => { /* não crítico — agendamento já foi salvo na Conversation */ });
  }

  // Sincroniza Lead.attendanceStatus (legacy) quando o status da Conversation muda
  if (data.status) {
    const legacy = mapConvStatusToLegacy(updated.status);
    await prisma.lead.updateMany({
      where: { conversationId: conv.id, attendanceStatus: { not: legacy } },
      data:  { attendanceStatus: legacy },
    }).catch(() => { /* não crítico */ });
  }

  return NextResponse.json(updated);
}

// POST /api/conversations/[id] — marca como lida (zera unreadCount)
// body opcional: { action: "markRead" }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  if (body.action === "markRead") {
    await prisma.conversation.update({
      where: { id },
      data: { unreadCount: 0 },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
}
