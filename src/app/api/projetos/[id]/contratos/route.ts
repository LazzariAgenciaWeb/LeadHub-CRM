import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getViewer, canSeeProject } from "@/lib/visibility";
import { syncProjectsStatus } from "@/lib/project-vigencia";

// PUT /api/projetos/[id]/contratos
// Body: { ids: string[] } — contratos do cliente que este projeto entrega.
//
// Substitui o conjunto: os marcados passam a apontar pra este projeto (saindo
// de outro, se estavam lá — contrato tem um projeto só) e os que estavam aqui e
// não vieram ficam soltos. A vigência do projeto é recalculada em seguida.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;

  const project = await prisma.setorClickupList.findUnique({
    where: { id },
    include: {
      setor:       { select: { companyId: true } },
      members:     { select: { userId: true } },
      accessUsers: { select: { userId: true } },
    },
  });
  if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && project.setor.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  const viewer = await getViewer(session);
  if (!canSeeProject(viewer, {
    visibility: project.visibility,
    setorId: project.setorId,
    memberIds: project.members.map((m) => m.userId),
    accessUserIds: project.accessUsers.map((a) => a.userId),
  })) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  if (!project.clientCompanyId) {
    return NextResponse.json({ error: "Defina o cliente do projeto antes de ligar contratos." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String).slice(0, 50) : [];

  // Só contratos DESTE cliente — id de outro cliente cai fora do where.
  const alvo = ids.length
    ? await prisma.clientService.findMany({
        where:  { id: { in: ids }, clientCompanyId: project.clientCompanyId },
        select: { id: true, projectId: true },
      })
    : [];
  const atuais = await prisma.clientService.findMany({ where: { projectId: id }, select: { id: true } });
  const manter = new Set(alvo.map((c) => c.id));

  await prisma.$transaction([
    prisma.clientService.updateMany({
      where: { id: { in: atuais.map((c) => c.id).filter((x) => !manter.has(x)) } },
      data:  { projectId: null },
    }),
    prisma.clientService.updateMany({ where: { id: { in: [...manter] } }, data: { projectId: id } }),
  ]);

  // Este projeto e os que perderam contrato pra ele.
  await syncProjectsStatus([id, ...alvo.map((c) => c.projectId)]);

  const fresh = await prisma.setorClickupList.findUnique({ where: { id }, select: { status: true } });
  return NextResponse.json({ ok: true, linked: manter.size, status: fresh?.status });
}
