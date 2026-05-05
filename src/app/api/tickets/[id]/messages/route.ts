import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, addCommentToClickupTask } from "@/lib/clickup";
import { addScoreOnce } from "@/lib/gamification";

// POST /api/tickets/[id]/messages
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id: ticketId } = await params;
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) return NextResponse.json({ error: "Chamado não encontrado" }, { status: 404 });

  if (userRole !== "SUPER_ADMIN" && ticket.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const { messageBody, isInternal, mediaBase64, mediaType } = body;

  // Aceita mensagem vazia se houver anexo (igual WhatsApp permite mandar só foto)
  const hasMedia = !!(mediaBase64 && mediaType);
  if (!hasMedia && !messageBody?.trim()) {
    return NextResponse.json({ error: "Mensagem não pode ser vazia" }, { status: 400 });
  }

  // Se admin respondeu, muda status para IN_PROGRESS automaticamente
  const updates: any = {};
  if (userRole === "SUPER_ADMIN" && ticket.status === "OPEN") {
    updates.status = "IN_PROGRESS";
  }

  const [message] = await prisma.$transaction([
    prisma.ticketMessage.create({
      data: {
        body: (messageBody ?? "").trim(),
        authorName: session.user?.name ?? "Usuário",
        authorRole: userRole,
        // Notas internas: ADMIN ou SUPER_ADMIN da agência podem marcar
        isInternal: isInternal && (userRole === "SUPER_ADMIN" || userRole === "ADMIN"),
        mediaBase64: mediaBase64 || null,
        mediaType:   mediaType || null,
        source: "LEADHUB",
        ticketId,
      },
    }),
    ...(Object.keys(updates).length
      ? [prisma.ticket.update({ where: { id: ticketId }, data: updates })]
      : []),
  ]);

  // ── ClickUp comment sync ───────────────────────────────────────────────
  // Não sincroniza notas internas para o ClickUp.
  // Guarda o ID do comentário criado em externalId — usado pra dedup quando o
  // webhook do ClickUp devolver o mesmo comentário (evita loop infinito).
  const isInternalMsg = isInternal && (userRole === "SUPER_ADMIN" || userRole === "ADMIN");
  if (!isInternalMsg && ticket.clickupTaskId) {
    const clickupSettings = await getClickupSettings(ticket.companyId);
    if (clickupSettings) {
      const authorLabel = userRole === "SUPER_ADMIN"
        ? `💬 Suporte — ${session.user?.name ?? "Atendente"}`
        : `👤 Cliente — ${session.user?.name ?? "Usuário"}`;
      const clickupCommentId = await addCommentToClickupTask({
        apiToken: clickupSettings.apiToken,
        taskId: ticket.clickupTaskId,
        comment: `${authorLabel}\n\n${(messageBody ?? "").trim()}`,
      });
      if (clickupCommentId) {
        await prisma.ticketMessage.update({
          where: { id: message.id },
          data: { externalId: clickupCommentId },
        }).catch(() => { /* dedup só funciona se conseguir gravar; não crítico */ });
      }
    }
  }

  // ── Gamificação ────────────────────────────────────────────────────────
  // Notas internas não pontuam (são pra equipe interna, não atendimento).
  // Mensagens de SUPER_ADMIN também não pontuam (dono da plataforma, não
  // é atendente da empresa-cliente).
  const userId = (session.user as any)?.id as string | undefined;
  if (!isInternalMsg && userId && userRole !== "SUPER_ADMIN") {
    const dayKey = new Date().toISOString().slice(0, 10);

    if (!ticket.assigneeId) {
      // GUARDIÃO: primeiro a comentar em chamado sem responsável
      void addScoreOnce(
        userId, ticket.companyId, "PRIMEIRA_RESPOSTA",
        `ticket:${ticketId}:${userId}:${dayKey}:guardiao`,
      ).catch(() => {});
    } else if (ticket.assigneeId === userId) {
      // ALQUIMISTA: comentou no próprio chamado
      void addScoreOnce(
        userId, ticket.companyId, "TICKET_ATUALIZADO",
        `ticket:${ticketId}:${userId}:${dayKey}:alquimista`,
      ).catch(() => {});
    } else {
      // EXÉRCITO: comentou em chamado de outro responsável
      void addScoreOnce(
        userId, ticket.companyId, "AJUDA_EXERCITO",
        `ticket:${ticketId}:${userId}:${dayKey}:exercito`,
      ).catch(() => {});
    }
  }

  return NextResponse.json(message, { status: 201 });
}
