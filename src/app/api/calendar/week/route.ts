import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { listPrimaryEvents } from "@/lib/google-calendar";
import { assertModule } from "@/lib/billing";

// GET /api/calendar/week?from=ISO&to=ISO
//
// Retorna todos os itens com data dentro do intervalo, agrupados por tipo:
//   - retornos agendados (conversations.scheduledReturnAt)
//   - follow-ups de leads (lead.expectedReturnAt)
//   - chamados pelo prazo (tickets.dueDate, fallback createdAt quando sem prazo)
//   - eventos do Google Calendar (se conectado)
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "calendario");
  if (!gate.ok) return gate.response;

  const userId    = (session.user as any)?.id as string;
  const userRole  = (session.user as any)?.role as string;
  const companyId = (session.user as any)?.companyId as string | undefined;

  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from");
  const toParam   = searchParams.get("to");

  if (!fromParam || !toParam) {
    return NextResponse.json({ error: "from e to obrigatórios" }, { status: 400 });
  }
  const from = new Date(fromParam);
  const to   = new Date(toParam);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "datas inválidas" }, { status: 400 });
  }

  const cf = companyId ? { companyId } : {};

  // Default da agenda: cada usuário vê o que é DELE (assigneeId === userId)
  // mais o que está SEM responsável (assigneeId === null) — assim ele pode
  // assumir ou direcionar. Vale pra qualquer role; admin que quiser visão
  // de equipe abre /chamados, /crm, etc. (filtros lá já permitem).
  // Antes mostrava tudo da empresa pra todo mundo, vazando agendas.
  void userRole;
  const userScope = { OR: [{ assigneeId: userId }, { assigneeId: null }] };
  // Lead não tem assigneeId — vai pelo Conversation associado. Inclui também
  // leads sem conversa (sem responsável definido).
  const leadScope = {
    OR: [
      { conversation: { is: null } },
      { conversation: { is: { assigneeId: null } } },
      { conversation: { is: { assigneeId: userId } } },
    ],
  };

  const [scheduledConvs, leadsFollowUp, tickets] = await Promise.all([
    prisma.conversation.findMany({
      where: {
        ...cf,
        ...userScope,
        scheduledReturnAt: { gte: from, lte: to },
      },
      select: {
        id: true, phone: true, isGroup: true,
        scheduledReturnAt: true, returnNote: true, status: true,
        leads: { take: 1, orderBy: { createdAt: "desc" }, select: { id: true, name: true } },
      },
      orderBy: { scheduledReturnAt: "asc" },
      take: 200,
    }),
    prisma.lead.findMany({
      where: {
        ...cf,
        ...leadScope,
        expectedReturnAt: { gte: from, lte: to },
        status: { notIn: ["CLOSED", "LOST"] },
      },
      select: {
        id: true, name: true, phone: true,
        pipeline: true, pipelineStage: true,
        expectedReturnAt: true, status: true,
      },
      orderBy: { expectedReturnAt: "asc" },
      take: 200,
    }),
    prisma.ticket.findMany({
      where: {
        ...cf,
        isInternal: false,
        // AND combina dois ORs: escopo do usuário + janela de data.
        // Posiciona pelo prazo quando existe; createdAt só como fallback
        // pra tickets antigos sem dueDate.
        AND: [
          { OR: [{ assigneeId: userId }, { assigneeId: null }] },
          {
            OR: [
              { dueDate: { gte: from, lte: to } },
              { dueDate: null, createdAt: { gte: from, lte: to } },
            ],
          },
        ],
      },
      select: {
        id: true, title: true, priority: true, status: true,
        createdAt: true, dueDate: true,
        company: { select: { id: true, name: true } },
      },
      orderBy: { dueDate: "asc" },
      take: 200,
    }),
  ]);

  // Resolve nome do grupo: Conversation só tem `phone` (JID @g.us). O nome
  // legível mora em CompanyContact (sincronizado via /api/whatsapp/group-name).
  // Faz lookup por phone das conversas que vieram, mapeia phone → name.
  const groupPhones = scheduledConvs
    .filter((c) => c.isGroup || c.phone.includes("@g.us"))
    .map((c) => c.phone);
  let phoneToContactName: Record<string, string> = {};
  if (groupPhones.length > 0 && companyId) {
    const contacts = await prisma.companyContact.findMany({
      where: { companyId, phone: { in: groupPhones }, isGroup: true },
      select: { phone: true, name: true },
    });
    for (const c of contacts) {
      if (c.name) phoneToContactName[c.phone] = c.name;
    }
  }
  const scheduledConvsWithName = scheduledConvs.map((c) => ({
    ...c,
    contactName: phoneToContactName[c.phone] ?? null,
  }));

  // Eventos do Google Calendar — se houver conexão ativa
  let googleEvents: any[] = [];
  let googleError: string | null = null;
  const googleConn = await prisma.userGoogleConnection.findUnique({
    where: { userId_service: { userId, service: "calendar" } },
    select: { id: true, status: true },
  });
  if (googleConn && googleConn.status === "ACTIVE") {
    try {
      googleEvents = await listPrimaryEvents(googleConn.id, from, to, 100);
    } catch (e: any) {
      googleError = e?.message ?? "Erro ao buscar eventos do Google";
    }
  }

  return NextResponse.json({
    scheduledConvs: scheduledConvsWithName,
    leadsFollowUp,
    tickets,
    googleEvents,
    googleError,
    range: { from: from.toISOString(), to: to.toISOString() },
  });
}
