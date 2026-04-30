import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { ActivityType, ConversationStatus } from "@/generated/prisma";
import { mapConvStatusToLegacy } from "@/lib/whatsapp";

const VALID_STATUS: ConversationStatus[] = ["OPEN", "PENDING", "IN_PROGRESS", "WAITING_CUSTOMER", "CLOSED"];

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

  const { id } = await params;
  const userId   = (session.user as any)?.id as string;
  const userName = (session.user as any)?.name as string;
  const userRole = (session.user as any)?.role;
  const userCompanyId = (session.user as any)?.companyId;

  const conv = await prisma.conversation.findUnique({
    where: { id },
    select: { id: true, companyId: true, status: true, assigneeId: true, setorId: true },
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
    activities.push({ type: "CONVERSATION_CLOSED", body: `${userName} finalizou a conversa`, meta: { from: conv.status, to: "CLOSED" } });
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
        if (body.status === "CLOSED") data.closedAt = new Date();
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
    },
  });

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
