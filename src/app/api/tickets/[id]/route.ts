import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, syncTicketToClickup } from "@/lib/clickup";

// GET /api/tickets/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      company:       { select: { id: true, name: true } },
      clientCompany: { select: { id: true, name: true, phone: true, email: true } },
      assignee:      { select: { id: true, name: true } },
      setor:         { select: { id: true, name: true } },
      messages:      { orderBy: { createdAt: "asc" } },
    },
  });

  if (!ticket) return NextResponse.json({ error: "Chamado não encontrado" }, { status: 404 });

  if (userRole !== "SUPER_ADMIN" && ticket.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  return NextResponse.json(ticket);
}

// PATCH /api/tickets/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const {
    status, priority, category, title, clickupTaskId, ticketStage, companyId,
    dueDate, assigneeId, setorId, clientCompanyId,
  } = body;

  // Fetch existing task ID before update (in case user didn't send it)
  const existing = await prisma.ticket.findUnique({
    where: { id },
    select: { clickupTaskId: true, type: true },
  });

  const ticket = await prisma.ticket.update({
    where: { id },
    data: {
      status, priority, category, title,
      ...(clickupTaskId !== undefined && { clickupTaskId: clickupTaskId ?? null }),
      ...(ticketStage !== undefined && { ticketStage: ticketStage ?? null }),
      ...(companyId !== undefined && { companyId }),
      ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
      ...(assigneeId !== undefined && { assigneeId: assigneeId ?? null }),
      ...(setorId !== undefined && { setorId: setorId ?? null }),
      ...(clientCompanyId !== undefined && { clientCompanyId: clientCompanyId ?? null }),
    },
    include: {
      company:       { select: { id: true, name: true } },
      clientCompany: { select: { id: true, name: true } },
      assignee:      { select: { id: true, name: true } },
      setor:         { select: { id: true, name: true } },
    },
  });

  // ── ClickUp auto-sync ──────────────────────────────────────────────────
  // Only sync status/priority/stage updates — not manual ID changes
  const effectiveClickupId = ticket.clickupTaskId ?? existing?.clickupTaskId ?? null;
  if (effectiveClickupId && (status || priority || title || ticketStage)) {
    const clickupSettings = await getClickupSettings();
    if (clickupSettings) {
      await syncTicketToClickup({
        settings: clickupSettings,
        ticketId: id,
        existingClickupTaskId: effectiveClickupId,
        title: ticket.title,
        priority: ticket.priority,
        status: status ?? ticket.status,
      });
    }
  }

  return NextResponse.json(ticket);
}

// DELETE /api/tickets/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;
  await prisma.ticket.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
