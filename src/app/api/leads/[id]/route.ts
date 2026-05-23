import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, syncOportunidadeToClickup, addCommentToClickupTask } from "@/lib/clickup";
import { formatBrazilDateTime, formatBrazilDateTimeShort } from "@/lib/datetime";
import { addScore, addScoreOnce, revertScore } from "@/lib/gamification";
import { getUserPermissions } from "@/lib/user-permissions";
import { createConversationEvent } from "@/lib/conversation-events";

// GET /api/leads/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      messages: { orderBy: { receivedAt: "asc" }, take: 50 },
    },
  });

  if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

  if (userRole !== "SUPER_ADMIN" && lead.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  return NextResponse.json(lead);
}

// PATCH /api/leads/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const existing = await prisma.lead.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

  if (userRole !== "SUPER_ADMIN" && existing.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const perms = await getUserPermissions(session);
  if (!perms) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any).id as string | undefined;

  const body = await req.json();
  const { name, phone, email, source, status, notes, value, campaignId, pipeline, pipelineStage, attendanceStatus, expectedReturnAt, clickupTaskId, trackingLinkId } = body;

  // Atendente (CLIENT) sem canViewLeads PODE atualizar campos de atendimento
  // — agendar retorno, mudar attendanceStatus, anotar — desde que pertença
  // a algum setor (atende a conversa). O bloqueio de canViewLeads se aplica
  // só a alterações comerciais (pipeline, value, etc.). Antes o usuário
  // agendava no UI mas o backend devolvia 403 silencioso e nada persistia.
  const onlyAttendanceFields = (() => {
    const touchedKeys = Object.keys(body);
    const ATTENDANCE_KEYS = new Set(["attendanceStatus", "expectedReturnAt", "notes"]);
    return touchedKeys.length > 0 && touchedKeys.every((k) => ATTENDANCE_KEYS.has(k));
  })();
  const canAttend = !perms.noSetor; // tem ao menos um setor = pode atender
  if (!perms.isAdmin && !perms.canViewLeads && !(onlyAttendanceFields && canAttend)) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  // Auto-sync de lead.status ao mover pro Kanban: arrastar pra etapa "Fechado"
  // ou similar marca status=CLOSED; "Perdido" marca status=LOST. Sem isso o
  // gatilho de gamificação (LEAD_CONVERTIDO) nunca dispara — Kanban só envia
  // pipelineStage. Detecta por nome (ou config isFinal) ainda dá robustez.
  let derivedStatus: "CLOSED" | "LOST" | undefined;
  if (
    pipelineStage !== undefined &&
    pipelineStage !== existing.pipelineStage &&
    pipelineStage
  ) {
    const s = pipelineStage.toLowerCase();
    if (s.includes("fechado") || s.includes("ganho") || s.includes("vendi") || s.includes("vendid")) {
      if (existing.status !== "CLOSED") derivedStatus = "CLOSED";
    } else if (s.includes("perdido") || s.includes("perdeu") || s.includes("perda")) {
      if (existing.status !== "LOST") derivedStatus = "LOST";
    }
  }
  const effectiveStatus = status ?? derivedStatus;

  // Quando o lead sai do pipeline (volta pra caixa de entrada) ou é
  // fechado/perdido, o follow-up agendado perde sentido. Limpa
  // expectedReturnAt pra ele sumir do "Follow-ups de Leads" no Meu Dia.
  // Só aplica se o caller não está mexendo explicitamente em
  // expectedReturnAt no mesmo PATCH.
  const clearReturn =
    expectedReturnAt === undefined &&
    !!existing.expectedReturnAt &&
    (
      (pipeline === null) ||
      (effectiveStatus === "CLOSED" || effectiveStatus === "LOST")
    );

  const lead = await prisma.lead.update({
    where: { id },
    data: {
      name, phone, email, source,
      ...(effectiveStatus !== undefined && { status: effectiveStatus }),
      notes, value,
      campaignId: campaignId ?? undefined,
      ...(pipeline !== undefined && { pipeline }),
      ...(pipelineStage !== undefined && { pipelineStage }),
      ...(attendanceStatus !== undefined && { attendanceStatus: attendanceStatus ?? null }),
      ...(expectedReturnAt !== undefined && { expectedReturnAt: expectedReturnAt ? new Date(expectedReturnAt) : null }),
      ...(clearReturn && { expectedReturnAt: null }),
      ...(clickupTaskId !== undefined && { clickupTaskId: clickupTaskId ?? null }),
      ...(trackingLinkId !== undefined && { trackingLinkId: trackingLinkId ?? null }),
    },
    include: {
      company: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      trackingLink: { select: { id: true, code: true, label: true, clicks: true, destination: true, isActive: true, _count: { select: { clickEvents: true } } } },
    },
  });

  // Compatibilidade com botões antigos (UI legacy ainda usa attendanceStatus):
  // quando o lead tem (ou pode ter) Conversation, propaga pro Conversation.status.
  // Mapping: WAITING → OPEN, IN_PROGRESS → IN_PROGRESS, RESOLVED → CLOSED, SCHEDULED → SCHEDULED
  if (attendanceStatus !== undefined) {
    const map: Record<string, "OPEN" | "IN_PROGRESS" | "SCHEDULED" | "CLOSED" | null> = {
      WAITING: "OPEN", IN_PROGRESS: "IN_PROGRESS", SCHEDULED: "SCHEDULED", RESOLVED: "CLOSED",
    };
    const newConvStatus = attendanceStatus ? map[attendanceStatus] : null;
    if (newConvStatus) {
      // Busca o ID da Conversation. Fallback: se o Lead não está vinculado,
      // procura pela combinação (companyId, phone) que é única em Conversation.
      // Sem isso, leads antigos (criados antes do refactor de Conversation)
      // ficavam com status divergindo entre Lead.attendanceStatus e Conversation.status.
      let conversationId = lead.conversationId;
      if (!conversationId) {
        const conv = await prisma.conversation.findUnique({
          where: { companyId_phone: { companyId: existing.companyId, phone: existing.phone } },
          select: { id: true },
        }).catch(() => null);
        conversationId = conv?.id ?? null;
        // Vincula o lead à conversation encontrada (one-time fix)
        if (conversationId) {
          await prisma.lead.update({
            where: { id },
            data: { conversationId },
          }).catch(() => { /* não crítico */ });
          (lead as any).conversationId = conversationId;
        }
      }

      if (conversationId) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            status: newConvStatus,
            statusUpdatedAt: new Date(),
            ...(newConvStatus === "CLOSED" ? { closedAt: new Date() } : { closedAt: null }),
            // Sincroniza scheduledReturnAt na Conversation com expectedReturnAt do Lead
            ...(newConvStatus === "SCHEDULED" && expectedReturnAt
              ? { scheduledReturnAt: new Date(expectedReturnAt) }
              : {}),
          },
        }).catch(() => { /* não crítico */ });
      }
    }
  }

  // Cria nota visual no chat quando se agenda um retorno — bolha roxa
  // centralizada (estilo Chatwoot) pra todo mundo que abrir a conversa
  // ver imediatamente que tem retorno marcado.
  //
  // Dispara apenas quando expectedReturnAt está sendo SETADO (não null),
  // pra evitar spam ao limpar agendamento ou em updates não relacionados.
  const isSettingReturn = expectedReturnAt !== undefined && expectedReturnAt !== null;
  const wasReturnDifferent =
    !existing.expectedReturnAt ||
    (isSettingReturn && new Date(expectedReturnAt).getTime() !== existing.expectedReturnAt.getTime());
  if (isSettingReturn && wasReturnDifferent) {
    const returnDate = new Date(expectedReturnAt);
    const when = formatBrazilDateTime(returnDate);
    const noteText = `📅 Retorno agendado para ${when}`;
    const userId   = (session.user as any)?.id as string | undefined;
    const userName = (session.user as any)?.name as string | undefined;

    // 1) Persiste no ConversationNote (storage estruturado, type=SCHEDULED)
    if (lead.conversationId) {
      await prisma.conversationNote.create({
        data: {
          conversationId: lead.conversationId,
          body: noteText,
          type: "SCHEDULED",
          authorId: userId,
          authorName: userName ?? "Sistema",
        },
      }).catch(() => { /* não crítico */ });
    }

    // 2) Appenda em Lead.notes — formato legado que o parser da inbox lê
    //    pra renderizar na timeline imediatamente.
    const legacyEntry = `[${formatBrazilDateTimeShort(new Date())}] ${noteText}`;
    const newNotesValue = lead.notes ? `${legacyEntry}\n\n${lead.notes}` : legacyEntry;
    await prisma.lead.update({
      where: { id },
      data: { notes: newNotesValue },
    }).catch(() => { /* não crítico */ });
    // Mantém o objeto lead retornado em sincronia
    (lead as any).notes = newNotesValue;
  }

  // Gamificação — fire-and-forget
  if (userId) {
    // Lead avançou de etapa: cada etapa única conta uma vez (idempotente por
    // referenceId composto leadId:stageNome — assim não duplica se voltar/avançar)
    if (pipelineStage !== undefined && pipelineStage !== existing.pipelineStage && pipelineStage) {
      // Cada etapa diferente do mesmo lead conta — um lead pode dar 8pts × N etapas.
      // Não usa Once porque queremos contar cada movimentação (mas um stage repetido
      // ainda é contado se o usuário voltar e avançar novamente — é o comportamento
      // antigo, pode revisar se virar abuso).
      void addScore(userId, existing.companyId, "LEAD_AVANCADO", id).catch(() => {});
    }

    // Lead promovido pra Oportunidade — bônus distinto de LEAD_AVANCADO.
    // Cliente pediu orçamento → atendente arrasta pro pipeline OPORTUNIDADES.
    // Idempotente por leadId — não duplica se voltar e promover de novo.
    if (
      pipeline !== undefined &&
      pipeline === "OPORTUNIDADES" &&
      existing.pipeline !== "OPORTUNIDADES"
    ) {
      void addScoreOnce(
        userId, existing.companyId, "LEAD_VIROU_OPORTUNIDADE", id,
      ).catch(() => {});
    }
    // Oportunidade convertida em venda — idempotente. Só conta se o lead
    // estava no pipeline OPORTUNIDADES (lead "frio" virando venda não conta;
    // lead vira reuniao, oportunidade vira venda).
    // effectiveStatus pega tanto o status explicito do body quanto o
    // derivado da etapa (Kanban arrasta pra "Fechado" → status CLOSED).
    const wasOpportunity =
      existing.pipeline === "OPORTUNIDADES" || pipeline === "OPORTUNIDADES";
    if (effectiveStatus === "CLOSED" && existing.status !== "CLOSED" && wasOpportunity) {
      void addScoreOnce(userId, existing.companyId, "LEAD_CONVERTIDO", id).catch(() => {});

      // Easter eggs ligados a conversão:
      const today = new Date().toDateString();
      const createdToday = existing.createdAt.toDateString() === today;

      // 🍀 Sortudo: oportunidade criada e fechada no mesmo dia
      if (createdToday) {
        void addScoreOnce(userId, existing.companyId, "BONUS_VENDA_RAPIDA", id).catch(() => {});
      }

      // 🧨 Fênix: lead que já estava como LOST e voltou pra CLOSED
      if (existing.status === "LOST") {
        void addScoreOnce(userId, existing.companyId, "BONUS_RECUPERACAO", id).catch(() => {});
      }
    }
    // Penalidade: empurrar expectedReturnAt depois de já estar vencido (cumulativa)
    if (
      expectedReturnAt !== undefined && existing.expectedReturnAt &&
      existing.expectedReturnAt < new Date()
    ) {
      void addScore(userId, existing.companyId, "PRAZO_PRORROGADO", id).catch(() => {});
    }
  }

  // ── Activity (timeline + relatórios de conversão) ─────────────────────
  // Registra mudanças de pipeline e stage como eventos no Activity table.
  // O relatório de funil (em /relatorios?secao=funil) usa esses registros
  // pra calcular conversão entre pipelines (ex: leads → oportunidades).
  const authorName = (session?.user as any)?.name ?? null;
  if (pipeline !== undefined && pipeline !== existing.pipeline) {
    void prisma.activity.create({
      data: {
        type: "PIPELINE_CHANGED",
        leadId: id,
        companyId: existing.companyId,
        authorId: userId ?? null,
        authorName,
        body: `Pipeline: ${existing.pipeline ?? "—"} → ${pipeline ?? "—"}`,
        meta: { from: existing.pipeline, to: pipeline },
      },
    }).catch(() => null);
  }
  if (
    pipelineStage !== undefined &&
    pipelineStage !== existing.pipelineStage &&
    // Só registra se foi mudança dentro do mesmo pipeline (mudança de pipeline já cobre acima).
    (pipeline === undefined || pipeline === existing.pipeline)
  ) {
    void prisma.activity.create({
      data: {
        type: "STAGE_CHANGED",
        leadId: id,
        companyId: existing.companyId,
        authorId: userId ?? null,
        authorName,
        body: `Etapa: ${existing.pipelineStage ?? "—"} → ${pipelineStage ?? "—"}`,
        meta: { from: existing.pipelineStage, to: pipelineStage },
      },
    }).catch(() => null);
  }

  // ── ClickUp auto-sync (Oportunidades only) ────────────────────────────
  const effectivePipeline = pipeline ?? existing.pipeline;
  if (effectivePipeline === "OPORTUNIDADES") {
    const clickupSettings = await getClickupSettings(existing.companyId);
    if (clickupSettings?.oportunidadesListId) {
      const effectiveClickupId = lead.clickupTaskId ?? null;
      const newTaskId = await syncOportunidadeToClickup({
        settings: clickupSettings,
        leadId: id,
        existingClickupTaskId: effectiveClickupId,
        name: lead.name ?? lead.phone,
        notes: lead.notes,
        value: lead.value,
        pipelineStage: lead.pipelineStage,
      });
      // Persist the new task ID if it was just created
      if (newTaskId && !effectiveClickupId) {
        await prisma.lead.update({ where: { id }, data: { clickupTaskId: newTaskId } });
        (lead as any).clickupTaskId = newTaskId;
      }

      // Quando oportunidade é fechada (ganha), posta comentário no ClickUp
      // com valor e autor — fica registrado na task para o time ver.
      const taskId = (lead as any).clickupTaskId ?? newTaskId;
      if (taskId && effectiveStatus === "CLOSED" && existing.status !== "CLOSED") {
        const valueStr = lead.value
          ? `R$ ${lead.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
          : null;
        const authorLabel = session.user?.name ? ` por ${session.user.name}` : "";
        const closedMsg = ["🎉 Oportunidade fechada" + authorLabel, valueStr]
          .filter(Boolean).join(" — ");
        await addCommentToClickupTask({
          apiToken: clickupSettings.apiToken,
          taskId,
          comment: closedMsg,
        }).catch(() => { /* não crítico */ });
      }

      // Quando oportunidade é perdida, posta comentário no ClickUp também
      if (taskId && effectiveStatus === "LOST" && existing.status !== "LOST") {
        const authorLabel = session.user?.name ? ` por ${session.user.name}` : "";
        await addCommentToClickupTask({
          apiToken: clickupSettings.apiToken,
          taskId,
          comment: `❌ Oportunidade perdida${authorLabel}`,
        }).catch(() => { /* não crítico */ });
      }
    }
  }

  // ── Bolhas de evento na timeline da conversa ────────────────────────────
  // Eventos significativos: promoção pra Oportunidade, ganho, perda, mudança
  // de etapa. Fire-and-forget — não bloqueia a resposta.
  if (lead.phone && existing.companyId) {
    const sessionUserId   = (session.user as any)?.id ?? null;
    const sessionUserName = session.user?.name ?? null;

    // Pipeline: LEADS → OPORTUNIDADES (promoção)
    const promotedToOpp = pipeline === "OPORTUNIDADES" && existing.pipeline !== "OPORTUNIDADES";
    if (promotedToOpp) {
      const valueStr = lead.value
        ? ` — R$ ${lead.value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "";
      void createConversationEvent({
        companyId:  existing.companyId,
        phone:      lead.phone,
        type:       "OPP_CREATED",
        message:    `Lead virou Oportunidade: ${lead.name ?? lead.phone}${valueStr}`,
        authorId:   sessionUserId,
        authorName: sessionUserName,
        meta:       { leadId: id },
      });
    }

    // Status final: CLOSED (ganho) ou LOST (perdido)
    if (effectiveStatus === "CLOSED" && existing.status !== "CLOSED") {
      const isOpp = (pipeline ?? existing.pipeline) === "OPORTUNIDADES";
      const valueStr = lead.value
        ? ` — R$ ${lead.value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "";
      void createConversationEvent({
        companyId:  existing.companyId,
        phone:      lead.phone,
        type:       "OPP_WON",
        message:    `${isOpp ? "Oportunidade ganha" : "Lead convertido"}${valueStr}`,
        authorId:   sessionUserId,
        authorName: sessionUserName,
        meta:       { leadId: id },
      });
    } else if (effectiveStatus === "LOST" && existing.status !== "LOST") {
      void createConversationEvent({
        companyId:  existing.companyId,
        phone:      lead.phone,
        type:       "OPP_LOST",
        message:    `Oportunidade perdida: ${lead.name ?? lead.phone}`,
        authorId:   sessionUserId,
        authorName: sessionUserName,
        meta:       { leadId: id },
      });
    } else if (
      // Mudança de etapa dentro do mesmo pipeline (sem ser pra ganho/perda) —
      // promoção já foi tratada acima.
      !promotedToOpp &&
      pipelineStage !== undefined &&
      pipelineStage !== existing.pipelineStage &&
      pipelineStage &&
      existing.pipelineStage
    ) {
      void createConversationEvent({
        companyId:  existing.companyId,
        phone:      lead.phone,
        type:       "LEAD_MOVED",
        message:    `${existing.pipelineStage} → ${pipelineStage}`,
        authorId:   sessionUserId,
        authorName: sessionUserName,
        meta:       { leadId: id },
      });
    }
  }

  return NextResponse.json(lead);
}

// DELETE /api/leads/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

  if (userRole !== "SUPER_ADMIN" && lead.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  // fix C2 — exclusão é destrutiva: só admin da empresa ou quem tem
  // canManageUsers (gerente/líder com permissão administrativa).
  const perms = await getUserPermissions(session);
  if (!perms) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!perms.isAdmin && !perms.canManageUsers) {
    return NextResponse.json({ error: "Sem permissão para excluir leads" }, { status: 403 });
  }

  // Desvincula as mensagens antes de deletar o lead
  await prisma.message.updateMany({ where: { leadId: id }, data: { leadId: null } });

  // Reverte pontuação atrelada ao lead — busca todos os usuários que pontuaram
  const orphanedEvents = await prisma.scoreEvent.findMany({
    where:  { companyId: lead.companyId, referenceId: id },
    select: { userId: true },
    distinct: ["userId"],
  });

  await prisma.lead.delete({ where: { id } });

  for (const ev of orphanedEvents) {
    await revertScore(ev.userId, lead.companyId, id).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
