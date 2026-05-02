import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, syncTicketToClickup } from "@/lib/clickup";
import { findOrCreateClientCompany } from "@/lib/client-company";

// GET /api/tickets?companyId=&status=&priority=&type=&assigneeId=&overdueOnly=&unassignedOnly=
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;
  const userId = (session.user as any).id;

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");
  const phone = searchParams.get("phone");
  const openOnly = searchParams.get("openOnly") === "true";
  const type = searchParams.get("type");                     // "SUPPORT" | "INTERNAL"
  const assigneeIdParam = searchParams.get("assigneeId");    // "me" → userId atual
  const overdueOnly = searchParams.get("overdueOnly") === "true";
  const unassignedOnly = searchParams.get("unassignedOnly") === "true";

  const effectiveCompanyId = userRole === "SUPER_ADMIN" ? companyId : userCompanyId;

  const where: any = {};
  if (effectiveCompanyId) where.companyId = effectiveCompanyId;
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (phone) where.phone = phone;
  if (openOnly) where.status = { in: ["OPEN", "IN_PROGRESS"] };
  if (type) where.type = type;
  if (assigneeIdParam === "me" && userId) where.assigneeId = userId;
  else if (assigneeIdParam) where.assigneeId = assigneeIdParam;
  if (unassignedOnly) where.assigneeId = null;
  if (overdueOnly) {
    where.dueDate = { lt: new Date() };
    where.status = { in: ["OPEN", "IN_PROGRESS"] };
  }
  // Clientes não veem chamados internos (criados pelo SUPER_ADMIN para uso interno)
  if (userRole !== "SUPER_ADMIN") where.isInternal = false;

  const tickets = await prisma.ticket.findMany({
    where,
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    include: {
      company:       { select: { id: true, name: true } },
      clientCompany: { select: { id: true, name: true } },
      assignee:      { select: { id: true, name: true } },
      setor:         { select: { id: true, name: true } },
      _count:        { select: { messages: true } },
    },
  });

  return NextResponse.json(tickets);
}

// POST /api/tickets
//
// Body:
//   title, description (required)
//   dueDate (required ISO string — força o atendente a ter prazo)
//   type ("SUPPORT" default | "INTERNAL")
//   priority, category, phone, isInternal (visibility)
//   companyId (super-admin only — empresa-dona/agência)
//   assigneeId, setorId
//
// Cliente do chamado (só pra type=SUPPORT):
//   clientCompanyId — id direto, OU
//   clientCompanyName + clientCompanyPhone? + clientCompanyEmail? — auto-cria
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;
  const userId = (session.user as any).id;

  const body = await req.json();
  const {
    title, description, priority, category, companyId, phone, isInternal,
    type, dueDate, assigneeId, setorId,
    clientCompanyId, clientCompanyName, clientCompanyPhone, clientCompanyEmail,
  } = body;

  if (!title || !description) {
    return NextResponse.json({ error: "Título e descrição são obrigatórios" }, { status: 400 });
  }
  if (!dueDate) {
    return NextResponse.json({ error: "Prazo (dueDate) é obrigatório" }, { status: 400 });
  }
  const dueDateParsed = new Date(dueDate);
  if (Number.isNaN(dueDateParsed.getTime())) {
    return NextResponse.json({ error: "Prazo inválido" }, { status: 400 });
  }

  const effectiveCompanyId = userRole === "SUPER_ADMIN" ? companyId : userCompanyId;
  if (!effectiveCompanyId) {
    return NextResponse.json({ error: "Empresa não informada" }, { status: 400 });
  }

  const ticketType = (type === "INTERNAL") ? "INTERNAL" : "SUPPORT";

  // Resolve cliente — só se SUPPORT. INTERNAL nunca tem cliente.
  let resolvedClientId: string | null = null;
  if (ticketType === "SUPPORT") {
    if (clientCompanyId) {
      // Valida que o ID existe e pertence à hierarquia da agência
      const client = await prisma.company.findUnique({
        where: { id: clientCompanyId },
        select: { id: true },
      });
      if (client) resolvedClientId = client.id;
    } else if (clientCompanyName) {
      try {
        resolvedClientId = await findOrCreateClientCompany({
          name: clientCompanyName,
          phone: clientCompanyPhone,
          email: clientCompanyEmail,
          parentCompanyId: effectiveCompanyId,
        });
      } catch (e: any) {
        return NextResponse.json({ error: e.message ?? "Erro ao resolver cliente" }, { status: 400 });
      }
    }
    // Se não veio nem id nem nome, ticket fica sem cliente (válido pra retrocompat)
  }

  const ticket = await prisma.ticket.create({
    data: {
      title,
      description,
      priority: priority ?? "MEDIUM",
      category: category || null,
      phone: phone || null,
      companyId: effectiveCompanyId,
      createdById: userId || null,
      isInternal: userRole === "SUPER_ADMIN" ? (isInternal ?? false) : false,
      type: ticketType,
      dueDate: dueDateParsed,
      clientCompanyId: resolvedClientId,
      assigneeId: assigneeId || null,
      setorId: setorId || null,
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
    include: {
      company:       { select: { id: true, name: true } },
      clientCompany: { select: { id: true, name: true } },
      assignee:      { select: { id: true, name: true } },
      setor:         { select: { id: true, name: true } },
      _count:        { select: { messages: true } },
    },
  });

  // ── ClickUp auto-sync (só SUPPORT — INTERNAL fica fora) ──────────────────
  if (ticket.type === "SUPPORT") {
    const clickupSettings = await getClickupSettings();
    if (clickupSettings?.ticketsListId) {
      const baseUrl = process.env.NEXTAUTH_URL ?? "";
      const leadhubUrl = `${baseUrl}/chamados/${ticket.id}`;
      const descWithLink = `${ticket.description}\n\n🔗 Ver no LeadHub: ${leadhubUrl}`;
      const newTaskId = await syncTicketToClickup({
        settings: clickupSettings,
        ticketId: ticket.id,
        title: ticket.title,
        description: descWithLink,
        priority: ticket.priority,
        status: ticket.status,
      });
      if (newTaskId) {
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { clickupTaskId: newTaskId },
        });
        (ticket as any).clickupTaskId = newTaskId;
      }
    }
  }

  return NextResponse.json(ticket, { status: 201 });
}
