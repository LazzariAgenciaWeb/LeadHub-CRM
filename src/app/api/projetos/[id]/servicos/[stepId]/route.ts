import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";

async function ownedStep(projectId: string, stepId: string, session: any) {
  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const step = await prisma.projectService.findUnique({
    where: { id: stepId },
    select: { id: true, projectId: true, project: { select: { setor: { select: { companyId: true } } } } },
  });
  if (!step || step.projectId !== projectId) {
    return { error: NextResponse.json({ error: "Etapa não encontrada" }, { status: 404 }) };
  }
  if (role !== "SUPER_ADMIN" && step.project.setor.companyId !== userCompanyId) {
    return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  return { ok: true as const };
}

// PATCH /api/projetos/[id]/servicos/[stepId]
// Body: { name?: string | null } para renomear, ou { move: "up" | "down" } para reordenar.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id, stepId } = await params;
  const owned = await ownedStep(id, stepId, session);
  if ("error" in owned) return owned.error;

  const body = await req.json().catch(() => ({}));

  if (body.move === "up" || body.move === "down") {
    const steps = await prisma.projectService.findMany({
      where: { projectId: id }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true },
    });
    const i = steps.findIndex((s) => s.id === stepId);
    const j = body.move === "up" ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < steps.length) {
      [steps[i], steps[j]] = [steps[j], steps[i]];
    }
    await prisma.$transaction(steps.map((s, idx) => prisma.projectService.update({ where: { id: s.id }, data: { order: idx } })));
    return NextResponse.json({ ok: true });
  }

  if ("name" in body) {
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
    await prisma.projectService.update({ where: { id: stepId }, data: { name } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
}

// DELETE /api/projetos/[id]/servicos/[stepId] — remove a etapa (tarefas ficam sem serviço).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id, stepId } = await params;
  const owned = await ownedStep(id, stepId, session);
  if ("error" in owned) return owned.error;

  await prisma.projectService.delete({ where: { id: stepId } });
  return NextResponse.json({ ok: true });
}
