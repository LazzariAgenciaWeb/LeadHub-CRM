import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";

// POST /api/projetos/[id]/followup
// Registra uma cobrança ao cliente — usado quando projeto está em
// AGUARDANDO_CLIENTE pra documentar o que foi enviado e quando se espera
// retorno. Não gera pontos (ação interna), só log.
//
// Body: { description: string, expectedAt?: string (ISO) }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const userId   = (session.user as any).id   as string | undefined;
  const userName = (session.user as any).name as string | undefined;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const role          = (session.user as any).role as string;

  const project = await prisma.setorClickupList.findUnique({
    where:   { id },
    include: { setor: { select: { companyId: true } } },
  });
  if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && project.setor.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { description, expectedAt } = await req.json();
  if (!description || typeof description !== "string" || !description.trim()) {
    return NextResponse.json({ error: "description obrigatório" }, { status: 400 });
  }

  const now = new Date();

  await prisma.$transaction([
    prisma.setorClickupList.update({
      where: { id },
      data: {
        clientLastContactAt: now,
        clientExpectedAt:    expectedAt ? new Date(expectedAt) : project.clientExpectedAt,
      },
    }),
    prisma.projectActivity.create({
      data: {
        projectId:   id,
        type:        "CLIENT_FOLLOWUP",
        taskName:    "Cobrança ao cliente",
        taskId:      "",
        description: description.trim(),
        authorId:    userId,
        authorName:  userName ?? "Usuário",
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
