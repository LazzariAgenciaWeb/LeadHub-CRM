import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, syncTicketToClickup } from "@/lib/clickup";

// POST /api/email/inbox/[id]/create-ticket
// { title?, dueDate, priority?, description? }
// Cria um chamado a partir de um email da caixa e vincula os dois:
// o email ganha ticketId (aba 📧 do chamado mostra a conversa) e respostas
// futuras do remetente caem no mesmo chamado via In-Reply-To.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return gate.response;
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const email = await prisma.inboxEmail.findFirst({
    where: { id, companyId },
    select: {
      id: true, subject: true, fromEmail: true, fromName: true,
      textBody: true, snippet: true, sentAt: true, ticketId: true,
      aiImportance: true, aiSummary: true,
    },
  });
  if (!email) return NextResponse.json({ error: "Email não encontrado" }, { status: 404 });
  if (email.ticketId) {
    return NextResponse.json({ error: "Este email já está vinculado a um chamado" }, { status: 400 });
  }

  if (!body?.dueDate) return NextResponse.json({ error: "Prazo (dueDate) é obrigatório" }, { status: 400 });
  const dueDate = new Date(body.dueDate);
  if (Number.isNaN(dueDate.getTime())) return NextResponse.json({ error: "Prazo inválido" }, { status: 400 });

  const title = String(body?.title ?? "").trim() || email.subject || `Email de ${email.fromName ?? email.fromEmail}`;
  const priority = ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(body?.priority) ? body.priority : "MEDIUM";

  const emailText = (email.textBody || email.snippet || "").trim().slice(0, 2000);
  const description = String(body?.description ?? "").trim() ||
    `📧 Chamado criado a partir de email.\n\nDe: ${email.fromName ?? ""} <${email.fromEmail}>\nData: ${email.sentAt.toLocaleString("pt-BR")}\nAssunto: ${email.subject || "(sem assunto)"}${email.aiSummary ? `\nResumo IA: ${email.aiSummary}` : ""}\n\n${emailText}`;

  const userId = (session.user as any).id ?? null;
  const userRole = (session.user as any).role ?? "ADMIN";

  const ticket = await prisma.ticket.create({
    data: {
      title,
      description,
      priority,
      companyId,
      createdById: userId,
      type: "SUPPORT",
      dueDate,
      messages: {
        create: {
          body: description,
          authorName: session.user?.name ?? "Usuário",
          authorRole: userRole,
          isInternal: false,
          source: "LEADHUB",
        },
      },
    },
    select: { id: true, title: true, description: true, priority: true, status: true, companyId: true, type: true },
  });

  // Vincula o email (e, por consequência, as respostas futuras da thread).
  await prisma.inboxEmail.update({ where: { id: email.id }, data: { ticketId: ticket.id } });

  // ClickUp best-effort — mesmo comportamento do POST /api/tickets.
  try {
    const clickupSettings = await getClickupSettings(companyId);
    if (clickupSettings?.ticketsListId) {
      const baseUrl = process.env.NEXTAUTH_URL ?? "";
      const newTaskId = await syncTicketToClickup({
        settings: clickupSettings,
        ticketId: ticket.id,
        title: ticket.title,
        description: `${ticket.description}\n\n🔗 Ver no LeadHub: ${baseUrl}/chamados/${ticket.id}`,
        priority: ticket.priority,
        status: ticket.status,
        targetListId: clickupSettings.ticketsListId,
      });
      if (newTaskId) {
        await prisma.ticket.update({ where: { id: ticket.id }, data: { clickupTaskId: newTaskId } });
      }
    }
  } catch (e) {
    console.warn("[create-ticket] sync ClickUp falhou (chamado criado mesmo assim)", e);
  }

  return NextResponse.json({ ok: true, ticketId: ticket.id, title: ticket.title });
}
