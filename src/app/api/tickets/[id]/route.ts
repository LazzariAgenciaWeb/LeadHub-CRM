import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, syncTicketToClickup } from "@/lib/clickup";
import { addScore, addScoreOnce, revertScore } from "@/lib/gamification";
import { ActivityType } from "@/generated/prisma";
import { formatBrazilDateTime } from "@/lib/datetime";
import { getUserPermissions } from "@/lib/user-permissions";

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
      activities:    { orderBy: { createdAt: "asc" } },
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

  const userId   = (session.user as any).id as string | undefined;
  const userName = (session.user as any).name as string | undefined;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  // Carrega TODOS os campos relevantes antes do update — usado pra detectar
  // mudanças e logar activities de auditoria pra timeline.
  const existing = await prisma.ticket.findUnique({
    where: { id },
    select: {
      clickupTaskId: true, type: true, status: true,
      priority: true, ticketStage: true, title: true,
      assigneeId: true, setorId: true, clientCompanyId: true,
      dueDate: true, companyId: true, createdAt: true,
      assignee:      { select: { id: true, name: true } },
      setor:         { select: { id: true, name: true } },
      clientCompany: { select: { id: true, name: true } },
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "Chamado não encontrado" }, { status: 404 });
  }

  // fix C2 — isolamento + permissão. PATCH antes não validava nem que o
  // ticket era da empresa do usuário, nem que ele tinha canViewTickets.
  const userRole = (session.user as any).role as string | undefined;
  if (userRole !== "SUPER_ADMIN" && existing.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
  const perms = await getUserPermissions(session);
  if (!perms) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!perms.isAdmin && !perms.canViewTickets) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

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

  // ── Activity log: registra cada mudança como evento na timeline ──────────
  // Patterns reusados de Conversation: STATUS_CHANGED, ASSIGNEE_CHANGED, etc.
  // Cada Activity vira uma "linha de sistema" no chat do ticket.
  if (existing) {
    const activities: { type: ActivityType; body: string; meta?: any }[] = [];
    const STATUS_LABEL: Record<string, string> = {
      OPEN: "Aberto", IN_PROGRESS: "Em andamento", RESOLVED: "Resolvido", CLOSED: "Fechado",
    };

    if (status && status !== existing.status) {
      activities.push({
        type: ActivityType.STATUS_CHANGED,
        body: `${userName ?? "Usuário"} alterou status: ${STATUS_LABEL[existing.status] ?? existing.status} → ${STATUS_LABEL[status] ?? status}`,
        meta: { from: existing.status, to: status },
      });
    }
    if (ticketStage !== undefined && ticketStage !== existing.ticketStage) {
      activities.push({
        type: ActivityType.STAGE_CHANGED,
        body: `${userName ?? "Usuário"} mudou etapa: ${existing.ticketStage ?? "—"} → ${ticketStage ?? "—"}`,
        meta: { from: existing.ticketStage, to: ticketStage },
      });
    }
    if (priority && priority !== existing.priority) {
      const PRIORITY_LABEL: Record<string, string> = {
        LOW: "🟢 Baixa", MEDIUM: "🟡 Média", HIGH: "🟠 Alta", URGENT: "🔴 Urgente",
      };
      activities.push({
        type: ActivityType.VALUE_CHANGED,
        body: `${userName ?? "Usuário"} mudou prioridade: ${PRIORITY_LABEL[existing.priority] ?? existing.priority} → ${PRIORITY_LABEL[priority] ?? priority}`,
        meta: { field: "priority", from: existing.priority, to: priority },
      });
    }
    if (assigneeId !== undefined && assigneeId !== existing.assigneeId) {
      const newAssignee = ticket.assignee?.name ?? "—";
      const oldAssignee = existing.assignee?.name ?? "—";
      activities.push({
        type: ActivityType.ASSIGNEE_CHANGED,
        body: assigneeId
          ? `${userName ?? "Usuário"} atribuiu para ${newAssignee}` + (existing.assigneeId ? ` (antes: ${oldAssignee})` : "")
          : `${userName ?? "Usuário"} removeu atribuição (antes: ${oldAssignee})`,
        meta: { from: existing.assigneeId, to: assigneeId },
      });
    }
    if (setorId !== undefined && setorId !== existing.setorId) {
      const newSetor = ticket.setor?.name ?? "—";
      const oldSetor = existing.setor?.name ?? "—";
      activities.push({
        type: ActivityType.SECTOR_CHANGED,
        body: setorId
          ? `${userName ?? "Usuário"} mudou setor: ${oldSetor} → ${newSetor}`
          : `${userName ?? "Usuário"} removeu setor (antes: ${oldSetor})`,
        meta: { from: existing.setorId, to: setorId },
      });
    }
    if (clientCompanyId !== undefined && clientCompanyId !== existing.clientCompanyId) {
      const newClient = ticket.clientCompany?.name ?? "—";
      const oldClient = existing.clientCompany?.name ?? "—";
      activities.push({
        type: ActivityType.VALUE_CHANGED,
        body: clientCompanyId
          ? `${userName ?? "Usuário"} ${existing.clientCompanyId ? "mudou" : "vinculou"} cliente: ${oldClient !== "—" ? oldClient + " → " : ""}${newClient}`
          : `${userName ?? "Usuário"} removeu cliente (antes: ${oldClient})`,
        meta: { field: "clientCompanyId", from: existing.clientCompanyId, to: clientCompanyId },
      });
    }
    if (dueDate !== undefined) {
      const newDue = dueDate ? new Date(dueDate) : null;
      const oldDue = existing.dueDate;
      const changed = (newDue?.getTime() ?? null) !== (oldDue?.getTime() ?? null);
      if (changed) {
        activities.push({
          type: ActivityType.VALUE_CHANGED,
          body: newDue
            ? `${userName ?? "Usuário"} ${oldDue ? "alterou" : "definiu"} prazo: ${oldDue ? formatBrazilDateTime(oldDue) + " → " : ""}${formatBrazilDateTime(newDue)}`
            : `${userName ?? "Usuário"} removeu prazo (antes: ${oldDue ? formatBrazilDateTime(oldDue) : "—"})`,
          meta: { field: "dueDate", from: oldDue?.toISOString() ?? null, to: newDue?.toISOString() ?? null },
        });
      }
    }
    if (title && title !== existing.title) {
      activities.push({
        type: ActivityType.VALUE_CHANGED,
        body: `${userName ?? "Usuário"} renomeou: "${existing.title}" → "${title}"`,
        meta: { field: "title", from: existing.title, to: title },
      });
    }

    if (activities.length > 0) {
      await prisma.activity.createMany({
        data: activities.map((a) => ({
          type: a.type,
          body: a.body,
          meta: a.meta ?? undefined,
          authorId: userId ?? null,
          authorName: userName ?? "Sistema",
          ticketId: id,
          companyId: existing.companyId,
        })),
      }).catch(() => { /* não crítico */ });
    }
  }

  // ── ClickUp auto-sync ──────────────────────────────────────────────────
  // Only sync status/priority/stage updates — not manual ID changes
  const effectiveClickupId = ticket.clickupTaskId ?? existing?.clickupTaskId ?? null;
  if (effectiveClickupId && (status || priority || title || ticketStage)) {
    const clickupSettings = await getClickupSettings(ticket.companyId);
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

  // Gamificação: pontua quando ticket vai para RESOLVED.
  // addScoreOnce é idempotente por (userId, reason, referenceId) — reabrir e
  // fechar o mesmo ticket de novo NÃO duplica pontos.
  if (status === "RESOLVED" && existing?.status !== "RESOLVED" && existing?.companyId) {
    const scorer = ticket.assigneeId ?? assigneeId ?? userId;
    if (scorer) {
      const now = new Date();
      void addScoreOnce(scorer, existing.companyId, "TICKET_RESOLVIDO", id).catch(() => {});

      // SNIPER: resolveu antes do dueDate
      if (existing.dueDate && now <= existing.dueDate) {
        void addScoreOnce(scorer, existing.companyId, "TICKET_NO_PRAZO", id).catch(() => {});
      }

      // TROVÃO: chamado criado e resolvido no MESMO dia (calendário)
      if (existing.createdAt && existing.createdAt.toDateString() === now.toDateString()) {
        void addScoreOnce(scorer, existing.companyId, "TICKET_RESOLVIDO_MESMO_DIA", id).catch(() => {});
      }

      // EXÉRCITO: quem resolveu não é o assignee atual (ajudou colega)
      if (existing.assigneeId && existing.assigneeId !== userId && userId) {
        const dayKey = now.toISOString().slice(0, 10);
        void addScoreOnce(
          userId, existing.companyId, "AJUDA_EXERCITO",
          `ticket:${id}:${userId}:${dayKey}:exercito`,
        ).catch(() => {});
      }
    }
  }

  // ALQUIMISTA: cada update no próprio chamado conta. Idempotente por
  // (ticket, user, dia) pra não inflar quando edita várias coisas seguidas.
  // Considera "update" qualquer mudança de status/assignee/setor/prioridade/
  // dueDate/título/etapa/cliente. Só conta se o updater É o assignee atual
  // (chamado próprio).
  const hasUpdate =
    status !== undefined || priority !== undefined || title !== undefined ||
    ticketStage !== undefined || dueDate !== undefined ||
    assigneeId !== undefined || setorId !== undefined || clientCompanyId !== undefined;
  if (hasUpdate && existing && userId && existing.assigneeId === userId) {
    const dayKey = new Date().toISOString().slice(0, 10);
    void addScoreOnce(
      userId, existing.companyId, "TICKET_ATUALIZADO",
      `ticket:${id}:${userId}:${dayKey}:alquimista`,
    ).catch(() => {});
  }

  // LÍDER: encaminhou chamado pra colega (mudou assignee/setor pra outro)
  const assigneeChanged = assigneeId !== undefined && assigneeId !== existing?.assigneeId;
  const setorChanged    = setorId    !== undefined && setorId    !== existing?.setorId;
  const isHandoff = (assigneeChanged && assigneeId && assigneeId !== userId) || setorChanged;
  if (isHandoff && existing && existing.status !== "RESOLVED" && existing.status !== "CLOSED" && userId) {
    const dayKey = new Date().toISOString().slice(0, 10);
    void addScoreOnce(
      userId, existing.companyId, "ENCAMINHAMENTO",
      `ticket:${id}:${userId}:${dayKey}:lider`,
    ).catch(() => {});
  }

  // GUARDIÃO: assumiu chamado que estava sem assignee (assignee era null)
  if (
    assigneeChanged && assigneeId &&
    !existing?.assigneeId && existing && userId
  ) {
    const dayKey = new Date().toISOString().slice(0, 10);
    void addScoreOnce(
      assigneeId, existing.companyId, "PRIMEIRA_RESPOSTA",
      `ticket:${id}:${assigneeId}:${dayKey}:guardiao`,
    ).catch(() => {});
  }

  // Penalidade: empurrar dueDate depois de já estar vencido (cumulativa).
  if (
    dueDate !== undefined && existing?.dueDate &&
    existing.dueDate < new Date() &&
    existing.companyId
  ) {
    const scorer = ticket.assigneeId ?? assigneeId ?? userId;
    if (scorer) {
      void addScore(scorer, existing.companyId, "PRAZO_PRORROGADO", id).catch(() => {});
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

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: { companyId: true },
  });

  // Identifica todos os usuários que pontuaram por este ticket (resolvido,
  // SLA vencido, etc.) — pode ser mais de um se o assigneeId mudou.
  const orphanedEvents = ticket ? await prisma.scoreEvent.findMany({
    where:  { companyId: ticket.companyId, referenceId: id },
    select: { userId: true },
    distinct: ["userId"],
  }) : [];

  await prisma.ticket.delete({ where: { id } });

  if (ticket) {
    for (const ev of orphanedEvents) {
      await revertScore(ev.userId, ticket.companyId, id).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}
