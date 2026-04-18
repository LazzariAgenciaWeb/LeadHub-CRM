import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, syncTicketToClickup } from "@/lib/clickup";

// GET /api/tickets?companyId=&status=&priority=
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");
  const phone = searchParams.get("phone");
  const openOnly = searchParams.get("openOnly") === "true";

  const effectiveCompanyId = userRole === "SUPER_ADMIN" ? companyId : userCompanyId;

  const where: any = {};
  if (effectiveCompanyId) where.companyId = effectiveCompanyId;
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (phone) where.phone = phone;
  if (openOnly) where.status = { in: ["OPEN", "IN_PROGRESS"] };
  // Clientes não veem chamados internos (criados pelo SUPER_ADMIN para uso interno)
  if (userRole !== "SUPER_ADMIN") where.isInternal = false;

  const tickets = await prisma.ticket.findMany({
    where,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      company: { select: { id: true, name: true } },
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json(tickets);
}

// POST /api/tickets
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;
  const userId = (session.user as any).id;

  const body = await req.json();
  const { title, description, priority, category, companyId, phone, isInternal } = body;

  if (!title || !description) {
    return NextResponse.json({ error: "Título e descrição são obrigatórios" }, { status: 400 });
  }

  const effectiveCompanyId = userRole === "SUPER_ADMIN" ? companyId : userCompanyId;
  if (!effectiveCompanyId) {
    return NextResponse.json({ error: "Empresa não informada" }, { status: 400 });
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
      messages: {
        create: {
          body: description,
          authorName: session.user?.name ?? "Usuário",
          authorRole: userRole,
          isInternal: false,
        },
      },
    },
    include: {
      company: { select: { id: true, name: true } },
      _count: { select: { messages: true } },
    },
  });

  // ── ClickUp auto-sync ──────────────────────────────────────────────────
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

  return NextResponse.json(ticket, { status: 201 });
}
