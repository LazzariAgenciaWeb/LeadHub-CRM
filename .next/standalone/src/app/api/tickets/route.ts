import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

  const effectiveCompanyId = userRole === "SUPER_ADMIN" ? companyId : userCompanyId;

  const where: any = {};
  if (effectiveCompanyId) where.companyId = effectiveCompanyId;
  if (status) where.status = status;
  if (priority) where.priority = priority;

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
  const { title, description, priority, category, companyId } = body;

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
      companyId: effectiveCompanyId,
      createdById: userId || null,
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

  return NextResponse.json(ticket, { status: 201 });
}
