import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getSetor(id: string, companyId: string) {
  return prisma.setor.findFirst({ where: { id, companyId } });
}

// GET /api/setores/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const companyId = (session.user as any).companyId as string;

  const setor = await prisma.setor.findFirst({
    where: { id, companyId },
    include: {
      users:     { include: { user: { select: { id: true, name: true, email: true } } } },
      instances: { include: { instance: { select: { id: true, instanceName: true, phone: true, status: true } } } },
      _count:    { select: { tickets: true } },
    },
  });

  if (!setor) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  return NextResponse.json(setor);
}

// PATCH /api/setores/[id] — atualiza setor (permissões + usuários + instâncias)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const companyId = (session.user as any).companyId as string;

  const existing = await getSetor(id, companyId);
  if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const {
    name,
    canManageUsers,
    canViewLeads,
    canCreateLeads,
    canViewTickets,
    canCreateTickets,
    canViewConfig,
    userIds,     // string[] | undefined — substitui lista completa se fornecido
    instanceIds, // string[] | undefined — substitui lista completa se fornecido
  } = body;

  // Atualiza campos escalares
  const setor = await prisma.setor.update({
    where: { id },
    data: {
      ...(name !== undefined             && { name: name.trim() }),
      ...(canManageUsers !== undefined   && { canManageUsers }),
      ...(canViewLeads !== undefined     && { canViewLeads }),
      ...(canCreateLeads !== undefined   && { canCreateLeads }),
      ...(canViewTickets !== undefined   && { canViewTickets }),
      ...(canCreateTickets !== undefined && { canCreateTickets }),
      ...(canViewConfig !== undefined    && { canViewConfig }),
    },
  });

  // Substitui lista de usuários (se enviada)
  if (Array.isArray(userIds)) {
    await prisma.setorUser.deleteMany({ where: { setorId: id } });
    if (userIds.length > 0) {
      await prisma.setorUser.createMany({
        data: userIds.map((uid: string) => ({ setorId: id, userId: uid })),
        skipDuplicates: true,
      });
    }
  }

  // Substitui lista de instâncias (se enviada)
  if (Array.isArray(instanceIds)) {
    await prisma.setorInstance.deleteMany({ where: { setorId: id } });
    if (instanceIds.length > 0) {
      await prisma.setorInstance.createMany({
        data: instanceIds.map((iid: string) => ({ setorId: id, instanceId: iid })),
        skipDuplicates: true,
      });
    }
  }

  // Retorna o setor atualizado com relações
  const updated = await prisma.setor.findUnique({
    where: { id },
    include: {
      users:     { include: { user: { select: { id: true, name: true, email: true } } } },
      instances: { include: { instance: { select: { id: true, instanceName: true, phone: true, status: true } } } },
      _count:    { select: { tickets: true } },
    },
  });

  return NextResponse.json(updated);
}

// DELETE /api/setores/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const companyId = (session.user as any).companyId as string;

  const existing = await getSetor(id, companyId);
  if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  await prisma.setor.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
