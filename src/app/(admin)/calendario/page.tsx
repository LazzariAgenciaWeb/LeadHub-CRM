import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import CalendarioBoard from "./CalendarioBoard";

export default async function CalendarioPage() {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const userId    = (session.user as any)?.id as string;
  const userRole  = (session.user as any)?.role as string;
  const companyId = (session.user as any)?.companyId as string | undefined;
  const isSuperAdmin = userRole === "SUPER_ADMIN";

  const now      = new Date();
  const today    = new Date(now); today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today); todayEnd.setHours(23, 59, 59, 999);
  const nextWeek = new Date(now); nextWeek.setDate(nextWeek.getDate() + 7);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo  = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const cf = companyId ? { companyId } : {};

  const [scheduledConvs, waitingConvs, myOpenConvs, urgentTickets, leadsFollowUp] =
    await Promise.all([
      // Retornos agendados (vencidos + hoje + próximos 7 dias)
      prisma.conversation.findMany({
        where: {
          ...cf,
          status: "SCHEDULED",
          scheduledReturnAt: { lte: nextWeek },
        },
        select: {
          id: true, phone: true, scheduledReturnAt: true, returnNote: true,
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
          ...(isSuperAdmin ? {} : { assigneeId: userId }),
          statusUpdatedAt: { lte: oneHourAgo },
        },
        select: {
          id: true, phone: true, statusUpdatedAt: true,
          assigneeId: true, assignee: { select: { id: true, name: true } },
          leads: { take: 1, orderBy: { createdAt: "desc" }, select: { id: true, name: true } },
        },
        orderBy: { statusUpdatedAt: "asc" },
        take: 20,
      }),

      // Conversas abertas atribuídas a mim
      prisma.conversation.findMany({
        where: {
          ...cf,
          status: { in: ["OPEN", "IN_PROGRESS"] },
          assigneeId: userId,
        },
        select: {
          id: true, phone: true, status: true,
          lastMessageAt: true, lastMessageBody: true, unreadCount: true,
          leads: { take: 1, orderBy: { createdAt: "desc" }, select: { id: true, name: true } },
        },
        orderBy: { lastMessageAt: "desc" },
        take: 20,
      }),

      // Chamados urgentes/altos com mais de 24h sem resolução
      prisma.ticket.findMany({
        where: {
          ...cf,
          status: { in: ["OPEN", "IN_PROGRESS"] },
          priority: { in: ["URGENT", "HIGH"] },
          isInternal: false,
          createdAt: { lte: oneDayAgo },
        },
        select: {
          id: true, title: true, priority: true, status: true, createdAt: true,
          company: { select: { id: true, name: true } },
        },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        take: 20,
      }),

      // Follow-ups de leads com data de hoje ou vencida
      prisma.lead.findMany({
        where: {
          ...cf,
          expectedReturnAt: { lte: todayEnd },
          status: { notIn: ["CLOSED", "LOST"] },
        },
        select: {
          id: true, name: true, phone: true,
          pipeline: true, pipelineStage: true,
          expectedReturnAt: true, status: true,
        },
        orderBy: { expectedReturnAt: "asc" },
        take: 20,
      }),
    ]);

  return (
    <CalendarioBoard
      scheduledConvs={scheduledConvs as any}
      waitingConvs={waitingConvs as any}
      myOpenConvs={myOpenConvs as any}
      urgentTickets={urgentTickets as any}
      leadsFollowUp={leadsFollowUp as any}
      currentUserId={userId}
      isSuperAdmin={isSuperAdmin}
    />
  );
}
