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

  const [scheduledConvs, leadsFollowUp, tickets] = await Promise.all([
    prisma.conversation.findMany({
      where: {
        ...cf,
        scheduledReturnAt: { gte: from, lte: to },
      },
      select: {
        id: true, phone: true, scheduledReturnAt: true, returnNote: true, status: true,
        leads: { take: 1, orderBy: { createdAt: "desc" }, select: { id: true, name: true } },
      },
      orderBy: { scheduledReturnAt: "asc" },
      take: 200,
    }),
    prisma.lead.findMany({
      where: {
        ...cf,
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
        // Posiciona pelo prazo quando existe; usa createdAt só como fallback
        // pra tickets antigos sem dueDate. Antes usava só createdAt — chamado
        // criado hoje com prazo amanhã não aparecia no calendário de amanhã.
        OR: [
          { dueDate: { gte: from, lte: to } },
          { dueDate: null, createdAt: { gte: from, lte: to } },
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
    scheduledConvs,
    leadsFollowUp,
    tickets,
    googleEvents,
    googleError,
    range: { from: from.toISOString(), to: to.toISOString() },
  });
}
