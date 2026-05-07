import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { listPrimaryEvents, type GoogleCalendarEvent } from "@/lib/google-calendar";
import CalendarioBoard from "./CalendarioBoard";

export default async function CalendarioPage() {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const userId    = (session.user as any)?.id as string;
  const userRole  = (session.user as any)?.role as string;
  const companyId = (session.user as any)?.companyId as string | undefined;
  const isSuperAdmin = userRole === "SUPER_ADMIN";
  const isManager   = isSuperAdmin || userRole === "ADMIN";
  // Meu Dia é SEMPRE per-user. ADMIN tem visão de gestor em outros lugares
  // (relatórios, dashboards), mas no Calendário queremos: minhas tarefas +
  // o que está sem responsável (pra eu poder pegar). Itens já atribuídos
  // a outros saem da MINHA lista e aparecem na lista DELES.
  // CLIENT ainda fica preso aos setores dele pra não ver coisa fora do escopo.
  const userSetorIds = (await prisma.setorUser.findMany({
    where: { userId },
    select: { setorId: true },
  })).map((s) => s.setorId);
  // Filtro reaproveitável pra Conversations:
  //   - Manager (ADMIN/SUPER): suas + sem responsável (qualquer setor)
  //   - CLIENT: suas + sem responsável NOS SEUS SETORES
  const convScopeFilter = {
    OR: [
      { assigneeId: userId },
      isManager
        ? { assigneeId: null }
        : (userSetorIds.length > 0
            ? { AND: [{ assigneeId: null }, { setorId: { in: userSetorIds } }] }
            : { id: "__never__" }), // CLIENT sem setor → nada de não-atribuído
    ],
  };

  const now      = new Date();
  const today    = new Date(now); today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today); todayEnd.setHours(23, 59, 59, 999);
  const nextWeek = new Date(now); nextWeek.setDate(nextWeek.getDate() + 7);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo  = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const cf = companyId ? { companyId } : {};

  const [scheduledConvs, waitingConvs, myOpenConvs, urgentTickets, leadsFollowUp] =
    await Promise.all([
      // Retornos agendados (vencidos + hoje + próximos 7 dias).
      // Filtra por scheduledReturnAt (não pelo status) — se o cliente responder
      // depois do agendamento, o status muda pra OPEN/IN_PROGRESS mas o
      // compromisso de retorno ainda existe e deve aparecer no calendário.
      // Não-super-admin só vê os agendamentos onde é o responsável (assignee).
      prisma.conversation.findMany({
        where: {
          ...cf,
          scheduledReturnAt: { not: null, lte: nextWeek },
          ...convScopeFilter,
        },
        select: {
          id: true, phone: true, companyId: true, scheduledReturnAt: true, returnNote: true,
          assigneeId: true, assignee: { select: { id: true, name: true } },
          leads: { take: 1, orderBy: { createdAt: "desc" }, select: { id: true, name: true } },
        },
        orderBy: { scheduledReturnAt: "asc" },
      }),

      // Aguardando cliente — atribuídas ao usuário (ou todas para admin)
      prisma.conversation.findMany({
        where: {
          ...cf,
          status: "WAITING_CUSTOMER",
          ...convScopeFilter,
          statusUpdatedAt: { lte: oneHourAgo },
        },
        select: {
          id: true, phone: true, companyId: true, statusUpdatedAt: true,
          assigneeId: true, assignee: { select: { id: true, name: true } },
          leads: { take: 1, orderBy: { createdAt: "desc" }, select: { id: true, name: true } },
        },
        orderBy: { statusUpdatedAt: "asc" },
        take: 20,
      }),

      // Conversas abertas atribuídas a mim — ADMIN/SUPER_ADMIN vê todas da empresa
      prisma.conversation.findMany({
        where: {
          ...cf,
          status: { in: ["OPEN", "IN_PROGRESS"] },
          ...convScopeFilter,
        },
        select: {
          id: true, phone: true, companyId: true, status: true,
          lastMessageAt: true, lastMessageBody: true, unreadCount: true,
          leads: { take: 1, orderBy: { createdAt: "desc" }, select: { id: true, name: true } },
        },
        orderBy: { lastMessageAt: "desc" },
        take: 20,
      }),

      // Chamados/tarefas: prazo em até 7 dias OU criados hoje (mesmo sem prazo).
      // Ordena por dueDate ASC; tickets sem dueDate caem no final.
      // Mesmo critério de Meu Dia: meus + sem responsável (pra pegar).
      // Tickets de outras pessoas aparecem no Meu Dia delas, não no meu.
      prisma.ticket.findMany({
        where: {
          ...cf,
          status: { in: ["OPEN", "IN_PROGRESS"] },
          isInternal: false,
          AND: [
            {
              OR: [
                { dueDate: { lte: nextWeek } },
                { createdAt: { gte: today, lte: todayEnd } },
              ],
            },
            {
              OR: [
                { assigneeId: userId },
                isManager
                  ? { assigneeId: null }
                  : (userSetorIds.length > 0
                      ? { AND: [{ assigneeId: null }, { setorId: { in: userSetorIds } }] }
                      : { id: "__never__" }),
              ],
            },
          ],
        },
        select: {
          id: true, title: true, priority: true, status: true, type: true,
          dueDate: true, createdAt: true,
          company:       { select: { id: true, name: true } },
          clientCompany: { select: { id: true, name: true } },
          assignee:      { select: { id: true, name: true } },
        },
        orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
        take: 30,
      }),

      // Follow-ups de leads com data de hoje ou vencida.
      // Lead não tem assigneeId próprio — herda da Conversation vinculada.
      // Mesmo critério: meus (conversa atribuída a mim) + sem responsável
      // (no meu setor pra CLIENT, qualquer setor pra ADMIN/SUPER).
      prisma.lead.findMany({
        where: {
          ...cf,
          expectedReturnAt: { lte: todayEnd },
          status: { notIn: ["CLOSED", "LOST"] },
          OR: [
            { conversation: { is: { assigneeId: userId } } },
            isManager
              ? { conversation: { is: { assigneeId: null } } }
              : (userSetorIds.length > 0
                  ? { conversation: { is: { assigneeId: null, setorId: { in: userSetorIds } } } }
                  : { id: "__never__" }),
          ],
        },
        select: {
          id: true, name: true, phone: true, companyId: true,
          pipeline: true, pipelineStage: true,
          expectedReturnAt: true, status: true,
        },
        orderBy: { expectedReturnAt: "asc" },
        take: 20,
      }),
    ]);

  // ── Resolução de nomes (especialmente grupos do WhatsApp) ────────────────
  // Coleta todos os pares (companyId, phone) das conversas E dos leads pra
  // buscar CompanyContact em batch — assim mostramos o nome do grupo em
  // vez de "Grupo" no Follow-up de Leads também.
  type Keyed = { companyId: string; phone: string };
  const allKeyed: Keyed[] = [
    ...scheduledConvs.map((c) => ({ companyId: c.companyId, phone: c.phone })),
    ...waitingConvs.map((c)   => ({ companyId: c.companyId, phone: c.phone })),
    ...myOpenConvs.map((c)    => ({ companyId: c.companyId, phone: c.phone })),
    ...leadsFollowUp.map((l)  => ({ companyId: l.companyId, phone: l.phone })),
  ];
  const contactKeys = Array.from(new Set(allKeyed.map((k) => `${k.companyId}|${k.phone}`)));
  const contactNames: Record<string, string> = {};
  if (contactKeys.length > 0) {
    const phones = Array.from(new Set(allKeyed.map((k) => k.phone)));
    const companyIds = Array.from(new Set(allKeyed.map((k) => k.companyId)));
    const contacts = await prisma.companyContact.findMany({
      where: {
        companyId: { in: companyIds },
        phone: { in: phones },
      },
      select: { companyId: true, phone: true, name: true },
    });
    for (const c of contacts) {
      if (c.name) contactNames[`${c.companyId}|${c.phone}`] = c.name;
    }
  }

  // ── Conexão Google Calendar do usuário (per-user) ─────────────────────────
  const googleConn = await prisma.userGoogleConnection.findUnique({
    where: { userId_service: { userId, service: "calendar" } },
    select: { id: true, googleEmail: true, status: true },
  });

  // Busca eventos do Google só se houver conexão ativa.
  // Falhas aqui não devem quebrar a página — degradamos silenciosamente.
  let googleEvents: GoogleCalendarEvent[] = [];
  let googleError: string | null = null;
  if (googleConn && googleConn.status === "ACTIVE") {
    try {
      googleEvents = await listPrimaryEvents(googleConn.id, today, todayEnd, 30);
    } catch (e: any) {
      googleError = e?.message ?? "Erro ao carregar agenda do Google";
    }
  }

  return (
    <CalendarioBoard
      scheduledConvs={scheduledConvs as any}
      waitingConvs={waitingConvs as any}
      myOpenConvs={myOpenConvs as any}
      urgentTickets={urgentTickets as any}
      leadsFollowUp={leadsFollowUp as any}
      currentUserId={userId}
      isSuperAdmin={isSuperAdmin}
      googleConn={googleConn ? { email: googleConn.googleEmail, status: googleConn.status } : null}
      googleEvents={googleEvents as any}
      googleError={googleError}
      contactNames={contactNames}
    />
  );
}
