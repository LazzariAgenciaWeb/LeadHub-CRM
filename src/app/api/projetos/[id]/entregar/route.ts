import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getViewer, canSeeProject } from "@/lib/visibility";
import { awardProjectDelivery, syncProjectStatus } from "@/lib/project-vigencia";
import { logFinance, agencyOf } from "@/lib/finance-log";

// POST /api/projetos/[id]/entregar
// Body: { encerrar?: string[] } — contratos ligados que a entrega encerra.
//
// Entregar = carimba a entrega, dá os pontos da gamificação (idempotente) e
// encerra no Financeiro os contratos escolhidos. Quem escolhe é a pessoa: o
// site parcelado é "recorrente" na cobrança e não pode parar de ser cobrado só
// porque o site foi entregue. Se sobrar contrato vivo (gestão que continua), o
// projeto segue Ativo; senão vira Entregue e sai das listas.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const userId        = (session.user as any).id as string | undefined;

  const project = await prisma.setorClickupList.findUnique({
    where: { id },
    include: {
      setor:       { select: { companyId: true } },
      members:     { select: { userId: true } },
      accessUsers: { select: { userId: true } },
      contracts:   { select: { id: true, label: true, status: true, clientCompanyId: true } },
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

  const body = await req.json().catch(() => ({}));
  const pedidos = new Set<string>(Array.isArray(body?.encerrar) ? body.encerrar.map(String) : []);
  const encerrar = project.contracts.filter((c) => pedidos.has(c.id) && c.status !== "ENCERRADO");

  const deliveredAt = project.deliveredAt ?? new Date();
  const agora = new Date();
  await prisma.$transaction([
    prisma.setorClickupList.update({ where: { id }, data: { deliveredAt, status: "ENTREGUE" } }),
    ...encerrar.map((c) => prisma.clientService.update({
      where: { id: c.id },
      data:  { status: "ENCERRADO", endedAt: agora },
    })),
  ]);

  for (const c of encerrar) {
    await logFinance({
      companyId: await agencyOf(c.clientCompanyId),
      clientCompanyId: c.clientCompanyId,
      entity: "CONTRATO",
      entityId: c.id,
      action: "ENCERRADO",
      description: `Projeto "${project.name}" entregue`,
      meta: { label: c.label, statusAntes: c.status, statusDepois: "ENCERRADO", projetoId: id },
      session,
    });
  }

  await awardProjectDelivery({
    projectId: id, companyId: project.setor.companyId, dueDate: project.dueDate, deliveredAt, fallbackUserId: userId,
  });

  // Contrato que continua vivo (gestão) mantém o projeto Ativo.
  await syncProjectStatus(id);

  await prisma.projectActivity.create({
    data: {
      projectId:  id,
      type:       "PROJECT_DELIVERED",
      taskId:     "",
      taskName:   encerrar.length ? `Entregue · encerrou ${encerrar.map((c) => c.label).join(", ")}` : "Entregue",
      authorId:   userId ?? null,
      authorName: (session.user as any).name ?? "Sistema",
    },
  }).catch(() => {});

  const fresh = await prisma.setorClickupList.findUnique({ where: { id }, select: { status: true } });
  return NextResponse.json({ ok: true, status: fresh?.status, encerrados: encerrar.length });
}
