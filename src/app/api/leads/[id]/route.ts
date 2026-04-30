import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, syncOportunidadeToClickup } from "@/lib/clickup";

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
  // quando o lead tem Conversation vinculada, propaga a mudança para Conversation.status.
  // Mapping: WAITING → OPEN, IN_PROGRESS → IN_PROGRESS, RESOLVED → CLOSED, SCHEDULED → SCHEDULED
  if (attendanceStatus !== undefined && lead.conversationId) {
    const map: Record<string, "OPEN" | "IN_PROGRESS" | "SCHEDULED" | "CLOSED" | null> = {
      WAITING: "OPEN", IN_PROGRESS: "IN_PROGRESS", SCHEDULED: "SCHEDULED", RESOLVED: "CLOSED",
    };
    const newConvStatus = attendanceStatus ? map[attendanceStatus] : null;
    if (newConvStatus) {
      await prisma.conversation.update({
        where: { id: lead.conversationId },
        data: {
          status: newConvStatus,
          statusUpdatedAt: new Date(),
          ...(newConvStatus === "CLOSED" ? { closedAt: new Date() } : { closedAt: null }),
        },
      }).catch(() => { /* não crítico */ });
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
