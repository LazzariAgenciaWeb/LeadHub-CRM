import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getViewer, ticketVisibilityWhere } from "@/lib/visibility";
import { loadTicketStages } from "@/lib/ticket-stages";
import { readPref } from "@/lib/chamados-view-pref";
import TicketsBoard, { type BoardTicket } from "./TicketsBoard";
import SuperAdminCompanyGate from "@/components/SuperAdminCompanyGate";

export const dynamic = "force-dynamic";

export default async function ChamadosPage() {
  const session = await getEffectiveSession();
  const user = session?.user as { id?: string; role?: string; companyId?: string } | undefined;

  // Super admin sem impersonar: chamados são por empresa — pede o cliente primeiro.
  if (user?.role === "SUPER_ADMIN") return <SuperAdminCompanyGate title="Chamados" />;

  const companyId = user?.companyId ?? "";
  const userId = user?.id ?? "";

  const where: Record<string, unknown> = { companyId, isInternal: false };
  // Visibilidade aberto/restrito
  const visWhere = ticketVisibilityWhere(await getViewer(session));
  if (visWhere) where.AND = [visWhere];

  const [stages, pref, rows] = await Promise.all([
    loadTicketStages(companyId),
    readPref(userId),
    prisma.ticket.findMany({
      where,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      include: {
        clientCompany: { select: { id: true, name: true } },
        assignee:      { select: { id: true, name: true } },
        setor:         { select: { id: true, name: true } },
        _count:        { select: { messages: true } },
        // Última mensagem visível ao cliente: se foi ELE quem falou por último,
        // o chamado está esperando a gente (selo "Cliente aguardando"). Vale a
        // origem, não o papel — atendente da agência também tem role CLIENT;
        // o cliente de fato escreve pelo Meu Espaço ou pelo link (CLIENT_PORTAL).
        messages: {
          where:   { isInternal: false },
          orderBy: { createdAt: "desc" },
          take:    1,
          select:  { source: true, createdAt: true },
        },
      },
    }),
  ]);

  const tickets: BoardTicket[] = rows.map((t) => {
    const last = t.messages[0];
    return {
      id: t.id, title: t.title, status: t.status, priority: t.priority, category: t.category,
      ticketStage: t.ticketStage, type: t.type === "INTERNAL" ? "INTERNAL" : "SUPPORT",
      visibility: t.visibility,
      dueDate: t.dueDate?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
      assignee: t.assignee, setor: t.setor, clientCompany: t.clientCompany,
      messages: t._count.messages,
      clientWaitingSince: last?.source === "CLIENT_PORTAL" ? last.createdAt.toISOString() : null,
    };
  });

  return <TicketsBoard tickets={tickets} stages={stages} pref={pref} currentUserId={userId} />;
}
