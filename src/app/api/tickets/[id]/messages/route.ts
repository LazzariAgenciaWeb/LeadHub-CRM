import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, addCommentToClickupTask } from "@/lib/clickup";

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
  const { messageBody, isInternal } = body;

  if (!messageBody?.trim()) {
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
        body: messageBody.trim(),
        authorName: session.user?.name ?? "Usuário",
        authorRole: userRole,
        isInternal: isInternal && userRole === "SUPER_ADMIN",
        ticketId,
      },
    }),
    ...(Object.keys(updates).length
      ? [prisma.ticket.update({ where: { id: ticketId }, data: updates })]
      : []),
  ]);

  // ── ClickUp comment sync ───────────────────────────────────────────────
  // Não sincroniza notas internas para o ClickUp
  const isInternalMsg = isInternal && userRole === "SUPER_ADMIN";
  if (!isInternalMsg && ticket.clickupTaskId) {
    const clickupSettings = await getClickupSettings();
    if (clickupSettings) {
      const authorLabel = userRole === "SUPER_ADMIN"
        ? `💬 Suporte — ${session.user?.name ?? "Atendente"}`
        : `👤 Cliente — ${session.user?.name ?? "Usuário"}`;
      await addCommentToClickupTask({
        apiToken: clickupSettings.apiToken,
        taskId: ticket.clickupTaskId,
        comment: `${authorLabel}\n\n${messageBody.trim()}`,
      });
    }
  }

  return NextResponse.json(message, { status: 201 });
}
