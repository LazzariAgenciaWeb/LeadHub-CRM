import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ActivityType } from "@/generated/prisma";
import { getUserPermissions } from "@/lib/user-permissions";

// PATCH /api/tickets/[id]/messages/[messageId]
// Edita o corpo de uma mensagem existente (usado no botão "editar" da
// Solicitação Original e de mensagens no chat do chamado).
//
// Permissão: SUPER_ADMIN, ADMIN da empresa, usuário com canViewTickets
// OU o criador do chamado. TicketMessage não tem authorId (só authorName),
// então não dá pra fazer "só quem escreveu edita" com segurança — quem
// gerencia o chamado edita, quem não gerencia não. Registrado no activity
// log ("X editou a solicitação/mensagem").
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id: ticketId, messageId } = await params;
  const userId       = (session.user as any).id as string | undefined;
  const userName     = (session.user as any).name as string | undefined;
  const userRole     = (session.user as any).role as string | undefined;
  const userCompany  = (session.user as any).companyId as string | undefined;

  const body = await req.json().catch(() => ({}));
  const newBody: unknown = body?.body;
  if (typeof newBody !== "string" || !newBody.trim()) {
    return NextResponse.json({ error: "Corpo obrigatório" }, { status: 400 });
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, companyId: true, createdById: true, description: true },
  });
  if (!ticket) return NextResponse.json({ error: "Chamado não encontrado" }, { status: 404 });

  if (userRole !== "SUPER_ADMIN" && ticket.companyId !== userCompany) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const perms = await getUserPermissions(session);
  if (!perms) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const canEdit =
    userRole === "SUPER_ADMIN" ||
    perms.isAdmin ||
    perms.canViewTickets ||
    (!!userId && ticket.createdById === userId);
  if (!canEdit) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const message = await prisma.ticketMessage.findUnique({
    where: { id: messageId },
    select: { id: true, ticketId: true, body: true, createdAt: true },
  });
  if (!message || message.ticketId !== ticketId) {
    return NextResponse.json({ error: "Mensagem não encontrada" }, { status: 404 });
  }

  // Identifica se é a mensagem inicial (mais antiga do chamado) — nesse caso
  // atualiza também Ticket.description pra manter consistência.
  const first = await prisma.ticketMessage.findFirst({
    where: { ticketId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const isInitial = first?.id === messageId;

  const trimmed = newBody.trim();
  const prevBody = message.body;

  const [updated] = await prisma.$transaction([
    prisma.ticketMessage.update({
      where: { id: messageId },
      data: { body: trimmed },
      select: {
        id: true, body: true, isInternal: true, authorName: true,
        authorRole: true, mediaType: true, source: true, createdAt: true, ticketId: true,
      },
    }),
    ...(isInitial && trimmed !== ticket.description
      ? [prisma.ticket.update({ where: { id: ticketId }, data: { description: trimmed } })]
      : []),
    prisma.activity.create({
      data: {
        type: ActivityType.VALUE_CHANGED,
        body: `${userName ?? "Usuário"} editou ${isInitial ? "a solicitação original" : "uma mensagem"}`,
        meta: { field: "messageBody", messageId, prev: prevBody, next: trimmed },
        authorId: userId ?? null,
        authorName: userName ?? "Sistema",
        ticketId,
        companyId: ticket.companyId,
      },
    }),
  ]);

  return NextResponse.json({ ...updated, hasMedia: !!updated.mediaType });
}

