import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";

// Confere que o material é do projeto [id] e que o projeto é da empresa.
async function ownedMaterial(id: string, materialId: string, session: any) {
  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const m = await prisma.projectMaterial.findUnique({
    where: { id: materialId },
    select: { id: true, projectId: true, project: { select: { setor: { select: { companyId: true } } } } },
  });
  if (!m || m.projectId !== id) {
    return { error: NextResponse.json({ error: "Material não encontrado" }, { status: 404 }) };
  }
  if (role !== "SUPER_ADMIN" && m.project.setor.companyId !== userCompanyId) {
    return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  return { ok: true as const };
}

// PATCH /api/projetos/[id]/materiais/[materialId]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; materialId: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id, materialId } = await params;
  const owned = await ownedMaterial(id, materialId, session);
  if ("error" in owned) return owned.error;

  const body = await req.json();
  const data: any = {};
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
  if (body.docHtml !== undefined) data.docHtml = body.docHtml || null;
  if (body.url     !== undefined) data.url     = body.url ? String(body.url).trim() : null;
  if (body.ata     !== undefined) data.ata     = body.ata || null;
  if (body.stage   !== undefined) data.stage   = body.stage ? String(body.stage).trim() : null;
  if (Number.isInteger(body.order)) data.order = body.order;
  if (body.taskId !== undefined) {
    // null solta o material no projeto; senão a tarefa precisa ser deste projeto.
    if (body.taskId) {
      const task = await prisma.projectTask.findUnique({ where: { id: body.taskId }, select: { projectId: true } });
      if (!task || task.projectId !== id) return NextResponse.json({ error: "Tarefa inválida" }, { status: 400 });
      data.taskId = body.taskId;
    } else {
      data.taskId = null;
    }
  }

  const material = await prisma.projectMaterial.update({ where: { id: materialId }, data });
  return NextResponse.json(material);
}

// DELETE /api/projetos/[id]/materiais/[materialId]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; materialId: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id, materialId } = await params;
  const owned = await ownedMaterial(id, materialId, session);
  if ("error" in owned) return owned.error;

  await prisma.projectMaterial.delete({ where: { id: materialId } });
  return NextResponse.json({ ok: true });
}
