import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/setores — lista setores da empresa
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const companyId = (session.user as any).companyId as string;
  const role      = (session.user as any).role as string;
  if (!companyId && role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const setores = await prisma.setor.findMany({
    where: { companyId },
    include: {
      users:     { include: { user: { select: { id: true, name: true, email: true } } } },
      instances: { include: { instance: { select: { id: true, instanceName: true, phone: true, status: true } } } },
      _count:    { select: { tickets: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(setores);
}

// POST /api/setores — cria setor
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const companyId = (session.user as any).companyId as string;
  if (!companyId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const {
    name,
    canManageUsers   = false,
    canViewLeads     = true,
    canCreateLeads   = false,
    canViewTickets   = true,
    canCreateTickets = true,
    canViewConfig    = false,
    userIds          = [] as string[],
    instanceIds      = [] as string[],
  } = body;

  if (!name?.trim()) return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });

  const setor = await prisma.setor.create({
    data: {
      name: name.trim(),
      companyId,
      canManageUsers,
      canViewLeads,
      canCreateLeads,
      canViewTickets,
      canCreateTickets,
      canViewConfig,
      users:     { create: userIds.map((uid: string) => ({ userId: uid })) },
      instances: { create: instanceIds.map((iid: string) => ({ instanceId: iid })) },
    },
    include: {
      users:     { include: { user: { select: { id: true, name: true, email: true } } } },
      instances: { include: { instance: { select: { id: true, instanceName: true, phone: true, status: true } } } },
    },
  });

  return NextResponse.json(setor, { status: 201 });
}
