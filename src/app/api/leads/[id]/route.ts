import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, syncOportunidadeToClickup } from "@/lib/clickup";
import { formatBrazilDateTime, formatBrazilDateTimeShort } from "@/lib/datetime";
import { addScore } from "@/lib/gamification";

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

  const userId = (session.user as any).id as string | undefined;

  const body = await req.json();
  const { name, phone, email, source, status, notes, value, campaignId, pipeline, pipelineStage, attendanceStatus, expectedReturnAt, clickupTaskId, trackingLinkId } = body;

  const lead = await prisma.lead.update({
    where: { id },
    data: {
      name, phone, email, source, status, notes, value,
      campaignId: campaignId ?? undefined,
      ...(pipeline !== undefined && { pipeline }),
      ...(pipelineStage !== undefined && { pipelineStage }),
      ...(attendanceStatus !== undefined && { attendanceStatus: attendanceStatus ?? null }),
      ...(expectedReturnAt !== undefined && { expectedReturnAt: expectedReturnAt ? new Date(expectedReturnAt) : null }),
      ...(clickupTaskId !== undefined && { clickupTaskId: clickupTaskId ?? null }),
      ...(trackingLinkId !== undefined && { trackingLinkId: trackingLinkId ?? null }),
    },
    include: {
      company: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      trackingLink: { select: { id: true, code: true, label: true, clicks: true, destination: true, _count: { select: { clickEvents: true } } } },
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
    // Lead avançou de etapa no pipeline
    if (pipelineStage !== undefined && pipelineStage !== existing.pipelineStage) {
      void addScore(userId, existing.companyId, "LEAD_AVANCADO", id).catch(() => {});
    }
    // Lead convertido (status CLOSED = venda fechada)
    if (status === "CLOSED" && existing.status !== "CLOSED") {
      void addScore(userId, existing.companyId, "LEAD_CONVERTIDO", id).catch(() => {});
    }
  }

  // ── ClickUp auto-sync (Oportunidades only) ────────────────────────────
  const effectivePipeline = pipeline ?? existing.pipeline;
  if (effectivePipeline === "OPORTUNIDADES") {
    const clickupSettings = await getClickupSettings();
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

  // Desvincula as mensagens antes de deletar o lead
  await prisma.message.updateMany({ where: { leadId: id }, data: { leadId: null } });
  await prisma.lead.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
