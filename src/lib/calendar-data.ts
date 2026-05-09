/**
 * calendar-data.ts
 *
 * Fonte ÚNICA dos buckets do calendário "Meu Dia".
 *
 * Antes existia código duplicado em:
 *   - src/app/(admin)/calendario/page.tsx (Server Component)
 *   - src/app/api/calendar/my-day/route.ts (API)
 * que divergiu (página filtrava por setor pra CLIENT, API não). Esta função
 * centraliza a regra. Mexer aqui = mexer nos dois lugares.
 *
 * Buckets retornados:
 *   - scheduledConvs   → Conversation com scheduledReturnAt (vencidos + hoje + próx 7d)
 *   - unansweredConvs  → cliente esperando resposta (lastMessageDirection=INBOUND)
 *   - inProgressConvs  → atendente trabalhando (status=IN_PROGRESS, msg out)
 *   - myTickets        → tickets atribuídos ao usuário (com prazo ≤ +7d ou criado hoje)
 *   - unassignedTickets → tickets sem responsável (só ADMIN/SUPER vê — vazio pra CLIENT)
 *   - leadsFollowUp    → Lead com expectedReturnAt vencido/hoje
 *
 * Escopo de visibilidade:
 *   - Manager (ADMIN/SUPER): meus + sem responsável (qualquer setor).
 *   - CLIENT: meus + sem responsável NOS MEUS SETORES. Sem setor → só meus.
 */

import { prisma } from "./prisma";
import { startOfTodayInSystemTZ, endOfTodayInSystemTZ } from "./datetime";

export interface CalendarDataInput {
  companyId: string | undefined;
  userId: string;
  isManager: boolean;
  /** Setores do CLIENT (lista vazia = sem setor). Ignorado se isManager=true. */
  userSetorIds: string[];
}

export async function getCalendarData(input: CalendarDataInput) {
  const { companyId, userId, isManager, userSetorIds } = input;

  const now      = new Date();
  const today    = startOfTodayInSystemTZ(now);
  const todayEnd = endOfTodayInSystemTZ(now);
  const nextWeek = new Date(now); nextWeek.setDate(nextWeek.getDate() + 7);

  const cf = companyId ? { companyId } : {};

  // Filtro "sem responsável" — manager vê qualquer setor; CLIENT só os dele.
  // CLIENT sem setor → vira id="__never__" (nunca casa) pra não vazar.
  const unassignedFilter = isManager
    ? { assigneeId: null }
    : (userSetorIds.length > 0
        ? { AND: [{ assigneeId: null }, { setorId: { in: userSetorIds } }] }
        : { id: "__never__" as const });

  const convScopeFilter = {
    OR: [{ assigneeId: userId }, unassignedFilter],
  };

  const [
    scheduledConvs,
    unansweredConvs,
    inProgressConvs,
    myTickets,
    unassignedTickets,
    leadsFollowUp,
  ] = await Promise.all([
    // ── 1. Retornos agendados ─────────────────────────────────────────────────
    // Filtra por scheduledReturnAt (não pelo status) — se o cliente responder
    // antes da hora marcada, o status muda mas o compromisso ainda existe.
    prisma.conversation.findMany({
      where: {
        ...cf,
        scheduledReturnAt: { not: null, lte: nextWeek },
        ...convScopeFilter,
      },
      select: {
        id: true, phone: true, isGroup: true, companyId: true,
        scheduledReturnAt: true, returnNote: true,
        assigneeId: true, assignee: { select: { id: true, name: true } },
        leads: { take: 1, orderBy: { createdAt: "desc" }, select: { id: true, name: true } },
      },
      orderBy: { scheduledReturnAt: "asc" },
    }),

    // ── 2. Não atendidas ──────────────────────────────────────────────────────
    // Cliente mandou mensagem e ninguém respondeu ainda. Status ativos
    // (OPEN/PENDING/IN_PROGRESS) + última mensagem INBOUND.
    // SCHEDULED fica de fora — já tá no bucket de retornos.
    // WAITING_CUSTOMER fica de fora — eu já respondi, é o cliente que tem que voltar.
    prisma.conversation.findMany({
      where: {
        ...cf,
        status: { in: ["OPEN", "PENDING", "IN_PROGRESS"] },
        lastMessageDirection: "INBOUND",
        ...convScopeFilter,
      },
      select: {
        id: true, phone: true, isGroup: true, companyId: true,
        status: true,
        statusUpdatedAt: true, lastMessageAt: true, lastMessageBody: true,
        unreadCount: true,
        assigneeId: true, assignee: { select: { id: true, name: true } },
        leads: { take: 1, orderBy: { createdAt: "desc" }, select: { id: true, name: true } },
      },
      // Mais antigas primeiro — quem espera há mais tempo é o mais urgente.
      orderBy: { lastMessageAt: "asc" },
      take: 30,
    }),

    // ── 3. Em andamento (já respondi, ativa) ──────────────────────────────────
    // IN_PROGRESS com última msg OUTBOUND — eu trabalhei nela hoje, mas não tá
    // em "não atendida" (não tem msg do cliente pendente).
    prisma.conversation.findMany({
      where: {
        ...cf,
        status: "IN_PROGRESS",
        lastMessageDirection: "OUTBOUND",
        assigneeId: userId, // só as minhas — sem responsável vai pra "não atendida"
      },
      select: {
        id: true, phone: true, companyId: true, status: true,
        lastMessageAt: true, lastMessageBody: true, unreadCount: true,
        leads: { take: 1, orderBy: { createdAt: "desc" }, select: { id: true, name: true } },
      },
      orderBy: { lastMessageAt: "desc" },
      take: 20,
    }),

    // ── 4. Meus chamados ──────────────────────────────────────────────────────
    // Tickets atribuídos a mim, com dueDate ≤ +7d OU criado hoje.
    // Inclui qualquer prioridade (não só URGENT/HIGH).
    prisma.ticket.findMany({
      where: {
        ...cf,
        status: { in: ["OPEN", "IN_PROGRESS"] },
        isInternal: false,
        assigneeId: userId,
        OR: [
          { dueDate: { lte: nextWeek } },
          { createdAt: { gte: today, lte: todayEnd } },
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

    // ── 5. Sem responsável (só visível pra ADMIN/SUPER) ───────────────────────
    // CLIENT respeita filtro de setor; ADMIN vê de qualquer setor.
    // Pra CLIENT sem setor, devolve [] direto (sem hit no DB).
    isManager
      ? prisma.ticket.findMany({
          where: {
            ...cf,
            status: { in: ["OPEN", "IN_PROGRESS"] },
            isInternal: false,
            assigneeId: null,
            OR: [
              { dueDate: { lte: nextWeek } },
              { createdAt: { gte: today, lte: todayEnd } },
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
        })
      : userSetorIds.length > 0
        ? prisma.ticket.findMany({
            where: {
              ...cf,
              status: { in: ["OPEN", "IN_PROGRESS"] },
              isInternal: false,
              assigneeId: null,
              setorId: { in: userSetorIds },
              OR: [
                { dueDate: { lte: nextWeek } },
                { createdAt: { gte: today, lte: todayEnd } },
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
          })
        : Promise.resolve([] as never[]),

    // ── 6. Follow-ups de leads ────────────────────────────────────────────────
    // Lead não tem assigneeId direto — herda da Conversation vinculada.
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

  return {
    scheduledConvs,
    unansweredConvs,
    inProgressConvs,
    myTickets,
    unassignedTickets,
    leadsFollowUp,
    generatedAt: now.toISOString(),
  };
}

/**
 * Resolve nomes de exibição (lead → contato → telefone formatado) em batch.
 * Útil pra mostrar nome do grupo do WhatsApp em vez de "Grupo".
 */
export async function resolveContactNames(
  items: Array<{ companyId: string; phone: string }>,
): Promise<Record<string, string>> {
  if (items.length === 0) return {};

  const phones = Array.from(new Set(items.map((k) => k.phone)));
  const companyIds = Array.from(new Set(items.map((k) => k.companyId)));

  const contacts = await prisma.companyContact.findMany({
    where: { companyId: { in: companyIds }, phone: { in: phones } },
    select: { companyId: true, phone: true, name: true },
  });

  const out: Record<string, string> = {};
  for (const c of contacts) {
    if (c.name) out[`${c.companyId}|${c.phone}`] = c.name;
  }
  return out;
}
