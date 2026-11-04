import { prisma } from "./prisma";

// Chamado liberado pelo link público de acompanhamento (/acompanhar/[token]).
// O token só existe quando o atendente marcou "cliente pode acompanhar", e
// chamado interno nunca abre por aqui. Revogar o link = apagar o publicToken.
export async function ticketByPublicToken(token: string) {
  if (!token || token.length < 8) return null;
  const ticket = await prisma.ticket.findUnique({
    where: { publicToken: token },
    select: {
      id: true, title: true, status: true, isInternal: true,
      companyId: true, clickupTaskId: true, assigneeId: true, createdById: true,
    },
  });
  if (!ticket || ticket.isInternal) return null;
  return ticket;
}
