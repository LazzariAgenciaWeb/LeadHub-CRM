import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getClickupSettings } from "@/lib/clickup";

const BASE = "https://api.clickup.com/api/v2";

/**
 * POST /api/tickets/[id]/sync-clickup
 * Cria (ou re-cria) a tarefa no ClickUp para este chamado e retorna o resultado detalhado.
 * Usado pelo botão "Sincronizar com ClickUp" na UI.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id: ticketId } = await params;

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { company: { select: { id: true, name: true } } },
  });
  if (!ticket) return NextResponse.json({ error: "Chamado não encontrado" }, { status: 404 });

  const settings = await getClickupSettings();
  if (!settings) {
    return NextResponse.json(
      { error: "ClickUp não configurado. Verifique API Token em Configurações → Integrações → ClickUp." },
      { status: 503 }
    );
  }
  if (!settings.ticketsListId) {
    return NextResponse.json(
      { error: "List ID de Chamados não configurado. Verifique em Configurações → Integrações → ClickUp." },
      { status: 503 }
    );
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? "";
  const leadhubUrl = `${baseUrl}/chamados/${ticket.id}`;

  // Corpo da tarefa — o mínimo necessário (sem tags, sem status)
  const taskBody: Record<string, unknown> = {
    name: ticket.title,
    description: `${ticket.description}\n\n🔗 Ver no LeadHub: ${leadhubUrl}`,
  };

  // Prioridade (opcional — ClickUp aceita 1-4)
  const PRIORITY_MAP: Record<string, number> = { URGENT: 1, HIGH: 2, MEDIUM: 3, LOW: 4 };
  if (PRIORITY_MAP[ticket.priority]) taskBody.priority = PRIORITY_MAP[ticket.priority];

  // Chama a API do ClickUp diretamente para capturar o erro completo
  const res = await fetch(`${BASE}/list/${settings.ticketsListId}/task`, {
    method: "POST",
    headers: {
      Authorization: settings.apiToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(taskBody),
  });

  const responseText = await res.text();
  let responseJson: any = null;
  try { responseJson = JSON.parse(responseText); } catch { /* not JSON */ }

  if (!res.ok) {
    return NextResponse.json({
      error: `ClickUp retornou ${res.status}`,
      clickupError: responseJson ?? responseText,
      listId: settings.ticketsListId,
      requestBody: taskBody,
    }, { status: 502 });
  }

  const taskId: string = responseJson?.id;
  if (!taskId) {
    return NextResponse.json({ error: "ClickUp não retornou task ID", response: responseJson }, { status: 502 });
  }

  // Salva no banco
  await prisma.ticket.update({ where: { id: ticketId }, data: { clickupTaskId: taskId } });

  return NextResponse.json({
    ok: true,
    clickupTaskId: taskId,
    clickupUrl: `https://app.clickup.com/t/${taskId}`,
  });
}
