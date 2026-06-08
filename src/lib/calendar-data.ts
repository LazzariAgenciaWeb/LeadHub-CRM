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

/** Dias sem interação pra um lead sem prazo entrar em "esfriando". */
export const STALE_AFTER_DAYS = 5;

/**
 * Pipelines que entram nos follow-ups. Prospect (PROSPECCAO) fica DE FORA —
 * é fila de prospecção em massa (dezenas/centenas), polui o painel e o push.
 * Follow-up é sobre não deixar esfriar quem já é lead/oportunidade.
 */
export const FOLLOWUP_PIPELINES = ["LEADS", "OPORTUNIDADES"];

/**
 * Guard de "oportunidade não-fechada" — fonte ÚNICA usada nos buckets de
 * follow-up (6 e 7) e no cron de lembrete diário. Mantém a regra de exclusão
 * de leads encerrados num lugar só pra não divergir.
 *
 * Exclui:
 *   - status CLOSED/LOST
 *   - etapas finais por NOME (Fechado/Ganho/Perdido/Vendido) — pega o caso
 *     legado onde o pipelineStage virou final mas o status não sincronizou
 *   - conversa vinculada já CLOSED (não há o que retornar)
 */
export const NOT_CLOSED_LEAD_WHERE: any = {
  status: { notIn: ["CLOSED", "LOST"] },
  NOT: {
    OR: [
      { pipelineStage: { contains: "echado",  mode: "insensitive" } }, // Fechado
      { pipelineStage: { contains: "ganho",   mode: "insensitive" } },
      { pipelineStage: { contains: "perdid",  mode: "insensitive" } }, // Perdido/Perdida
      { pipelineStage: { contains: "vendid",  mode: "insensitive" } }, // Vendido/Vendida
      { conversation: { is: { status: "CLOSED" } } },
    ],
  },
};

/**
 * Buckets de follow-up de leads/oportunidades (6 + 7 do "Meu Dia"):
 *   - leadsFollowUp → Lead com expectedReturnAt vencido/hoje (prazo formal)
 *   - staleLeads    → Lead sem prazo + sem interação há STALE_AFTER_DAYS dias
 *
 * Escopo (mesma regra do resto do Meu Dia): meus + sem responsável
 * (manager vê qualquer setor; CLIENT só os dele). Reaproveitado pelo widget
 * do dashboard e — em modo company-wide — referência pro cron de lembrete.
 */
export async function getLeadFollowUps(input: CalendarDataInput) {
  const { companyId, userId, isManager, userSetorIds } = input;

  const now      = new Date();
  const todayEnd = endOfTodayInSystemTZ(now);
  const staleCutoff = new Date(now);
  staleCutoff.setDate(staleCutoff.getDate() - STALE_AFTER_DAYS);

  const cf = companyId ? { companyId } : {};

  // Etapas finais configuráveis (isFinal) — leads nessas etapas estão encerrados
  // (ganho/perdido/concluído etc.) e NÃO precisam de follow-up. Mais robusto que
  // casar por palavra-chave no nome, pois respeita a config de pipeline da empresa.
  const finalStageRows = companyId
    ? await prisma.pipelineStageConfig.findMany({
        where: { companyId, isFinal: true },
        select: { name: true },
      })
    : [];
  const notFinalStage = finalStageRows.length
    ? { pipelineStage: { notIn: finalStageRows.map((s) => s.name) } }
    : {};

  // Scope: lead herda responsável da Conversation vinculada.
  const scopeOr: any[] = [
    { conversation: { is: { assigneeId: userId } } },
    isManager
      ? { conversation: { is: { assigneeId: null } } }
      : (userSetorIds.length > 0
          ? { conversation: { is: { assigneeId: null, setorId: { in: userSetorIds } } } }
          : { id: "__never__" }),
  ];

  const [leadsFollowUp, staleLeads] = await Promise.all([
    // ── 6. Follow-ups de leads (prazo formal vencido/hoje) ────────────────────
    prisma.lead.findMany({
      where: {
        ...cf,
        ...NOT_CLOSED_LEAD_WHERE,
        ...notFinalStage,
        pipeline: { in: FOLLOWUP_PIPELINES as any },
        expectedReturnAt: { lte: todayEnd },
        OR: scopeOr,
      },
      select: {
        id: true, name: true, phone: true, companyId: true,
        pipeline: true, pipelineStage: true,
        expectedReturnAt: true, status: true,
      },
      orderBy: { expectedReturnAt: "asc" },
      take: 20,
    }),

    // ── 7. Leads sem prazo, esfriando ─────────────────────────────────────────
    // Sai sozinho da lista quando o lead ganha um expectedReturnAt (vira bucket 6)
    // ou quando alguém manda mensagem (lastMessageAt sobe acima do cutoff).
    prisma.lead.findMany({
      where: {
        ...cf,
        ...NOT_CLOSED_LEAD_WHERE,
        ...notFinalStage,
        pipeline: { in: FOLLOWUP_PIPELINES as any },
        expectedReturnAt: null,
        AND: [
          {
            OR: [
              ...scopeOr,
              // Lead sem conversa: só manager pega (CLIENT não tem como derivar setor).
              ...(isManager ? [{ conversation: { is: null } }] : []),
            ],
          },
          // "Esfriando": conversa parada OU (sem conversa E updatedAt antigo).
          {
            OR: [
              { conversation: { is: { lastMessageAt: { lt: staleCutoff } } } },
              { AND: [{ conversation: { is: null } }, { updatedAt: { lt: staleCutoff } }] },
            ],
          },
        ],
      },
      select: {
        id: true, name: true, phone: true, companyId: true,
        pipeline: true, pipelineStage: true,
        status: true, updatedAt: true,
        conversation: { select: { lastMessageAt: true } },
      },
      orderBy: { updatedAt: "asc" }, // mais antigos primeiro = mais frios
      take: 15,
    }),
  ]);

  return { leadsFollowUp, staleLeads };
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
    followUps,
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

    // ── 6 + 7. Follow-ups de leads + leads esfriando ──────────────────────────
    // Extraídos pra getLeadFollowUps() — fonte única reaproveitada pelo widget
    // do dashboard (/api/followups/me) e pelo cron de lembrete diário.
    getLeadFollowUps(input),
  ]);

  const { leadsFollowUp, staleLeads } = followUps;

  return {
    scheduledConvs,
    unansweredConvs,
    inProgressConvs,
    myTickets,
    unassignedTickets,
    leadsFollowUp,
    staleLeads,
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
