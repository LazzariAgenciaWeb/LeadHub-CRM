import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// GET /api/calendar/my-day
// Retorna todos os itens relevantes para a vista "Meu Dia" do calendário.
// Inclui: retornos agendados, conversas aguardando cliente, conversas abertas
// atribuídas ao usuário, chamados com prazo vencendo, e follow-ups de leads.
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId      = (session.user as any)?.id as string;
  const userRole    = (session.user as any)?.role as string;
  const companyId   = (session.user as any)?.companyId as string | undefined;

  const isSuperAdmin = userRole === "SUPER_ADMIN";

  // Query param opcional: filtrar por outra empresa (só super admin)
  const { searchParams } = new URL(req.url);
  const filterCompanyId = isSuperAdmin
    ? (searchParams.get("companyId") ?? companyId)
    : companyId;

  const now   = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);

  // Janela de "futuro próximo" — retornos dos próximos 7 dias aparecem em "Em Breve"
  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const companyFilter = filterCompanyId ? { companyId: filterCompanyId } : {};

  // ── 1. Retornos Agendados ──────────────────────────────────────────────────
  // Conversas com status SCHEDULED que têm scheduledReturnAt definido.
  // Divididas em: vencidas (passadas), hoje, e em breve (próximos 7 dias).
  const scheduledConvs = await prisma.conversation.findMany({
    where: {
      ...companyFilter,
      status: "SCHEDULED",
      scheduledReturnAt: { lte: nextWeek }, // não mostrar retornos muito distantes
    },
    select: {
      id: true,
      phone: true,
      scheduledReturnAt: true,
      returnNote: true,
      assigneeId: true,
      assignee: { select: { id: true, name: true } },
      leads: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true },
      },
    },
    orderBy: { scheduledReturnAt: "asc" },
  });

  // ── 2. Conversas Aguardando Cliente ───────────────────────────────────────
  // WAITING_CUSTOMER atribuídas ao usuário atual (ou todas, para admins).
  // Mostra as que estão paradas há mais de 1 hora.
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const waitingConvs = await prisma.conversation.findMany({
    where: {
      ...companyFilter,
      status: "WAITING_CUSTOMER",
      ...(isSuperAdmin ? {} : { assigneeId: userId }),
      statusUpdatedAt: { lte: oneHourAgo },
    },
    select: {
      id: true,
      phone: true,
      statusUpdatedAt: true,
      assigneeId: true,
      assignee: { select: { id: true, name: true } },
      leads: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true },
      },
    },
    orderBy: { statusUpdatedAt: "asc" },
    take: 20,
  });

  // ── 3. Conversas Abertas Atribuídas a Mim ─────────────────────────────────
  // IN_PROGRESS e OPEN atribuídas ao usuário atual.
  const myOpenConvs = await prisma.conversation.findMany({
    where: {
      ...companyFilter,
      status: { in: ["OPEN", "IN_PROGRESS"] },
      assigneeId: userId,
    },
    select: {
      id: true,
      phone: true,
      status: true,
      lastMessageAt: true,
      lastMessageBody: true,
      unreadCount: true,
      leads: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true },
      },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 20,
  });

  // ── 4. Chamados com Prazo Crítico ─────────────────────────────────────────
  // Tickets OPEN/IN_PROGRESS com prioridade URGENT ou HIGH criados há mais
  // de 24 horas (aproximação de SLA sem campo de deadline ainda).
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const urgentTickets = await prisma.ticket.findMany({
    where: {
      ...companyFilter,
      status: { in: ["OPEN", "IN_PROGRESS"] },
      priority: { in: ["URGENT", "HIGH"] },
      isInternal: false,
      createdAt: { lte: oneDayAgo },
    },
    select: {
      id: true,
      title: true,
      priority: true,
      status: true,
      createdAt: true,
      company: { select: { id: true, name: true } },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 20,
  });

  // ── 5. Follow-ups de Leads/Oportunidades ──────────────────────────────────
  // Leads com expectedReturnAt vencido ou até fim do dia de hoje.
  const leadsFollowUp = await prisma.lead.findMany({
    where: {
      ...companyFilter,
      expectedReturnAt: { lte: todayEnd },
      status: { notIn: ["CLOSED", "LOST"] },
    },
    select: {
      id: true,
      name: true,
      phone: true,
      pipeline: true,
      pipelineStage: true,
      expectedReturnAt: true,
      status: true,
    },
    orderBy: { expectedReturnAt: "asc" },
    take: 20,
  });

  return NextResponse.json({
    scheduledConvs,
    waitingConvs,
    myOpenConvs,
    urgentTickets,
    leadsFollowUp,
    generatedAt: now.toISOString(),
  });
}
