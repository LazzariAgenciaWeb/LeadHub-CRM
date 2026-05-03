import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// GET /api/projetos — lista todos os projetos visíveis ao usuário
export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const where = role === "SUPER_ADMIN"
    ? {}
    : { setor: { companyId: userCompanyId } };

  const projects = await prisma.setorClickupList.findMany({
    where,
    include: {
      setor:         { select: { id: true, name: true, companyId: true } },
      clientCompany: { select: { id: true, name: true } },
      members:       { include: { user: { select: { id: true, name: true } } } },
    },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
  });

  return NextResponse.json({ projects });
}

// POST /api/projetos — cria projeto novo
// Body: { setorId, name, clickupListId, type?, description?, clientCompanyId?, dueDate?, startDate? }
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const body = await req.json();
  const { setorId, name, clickupListId, type, description, clientCompanyId, dueDate, startDate, memberIds } = body;
  if (!setorId || !name || !clickupListId) {
    return NextResponse.json({ error: "setorId, name e clickupListId obrigatórios" }, { status: 400 });
  }

  // Qualquer usuário só pode criar projetos para setores da própria empresa
  const setor = await prisma.setor.findUnique({ where: { id: setorId }, select: { companyId: true } });
  if (!setor) return NextResponse.json({ error: "Setor não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && setor.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão pra criar nesse setor" }, { status: 403 });
  }

  const project = await prisma.setorClickupList.create({
    data: {
      setorId,
      clickupListId,
      name,
      type:            type            ?? null,
      description:     description     ?? null,
      clientCompanyId: clientCompanyId ?? null,
      dueDate:         dueDate         ? new Date(dueDate)   : null,
      startDate:       startDate       ? new Date(startDate) : null,
    },
  });

  // Vincula responsáveis selecionados
  if (Array.isArray(memberIds) && memberIds.length > 0) {
    await prisma.projectMember.createMany({
      data: memberIds.map((userId: string) => ({
        projectId: project.id,
        userId,
        role: "MEMBER",
      })),
      skipDuplicates: true,
    });
  }

  return NextResponse.json(project, { status: 201 });
}
