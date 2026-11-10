import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { authorizeProjectTask } from "@/lib/project-task-access";
import { adjustmentView, ADJ_SELECT } from "@/lib/approval-adjustments";

// PATCH /api/projetos/[id]/tasks/[taskId]/ajustes/[adjId]   Body: { done: boolean }
// A equipe marca o ajuste como feito — o cliente vê "✓ feito" na versão nova.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; taskId: string; adjId: string }> }) {
  const { id, taskId, adjId } = await params;
  const auth = await authorizeProjectTask(await getEffectiveSession(), id, taskId);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const adj = await prisma.projectTaskAdjustment.findUnique({ where: { id: adjId }, select: { taskId: true } });
  if (!adj || adj.taskId !== taskId) return NextResponse.json({ error: "Ajuste não encontrado" }, { status: 404 });
  const done = body?.done === true;
  const row = await prisma.projectTaskAdjustment.update({
    where:  { id: adjId },
    data:   done ? { doneAt: new Date(), doneByName: auth.user.name ?? null } : { doneAt: null, doneByName: null },
    select: ADJ_SELECT,
  });
  return NextResponse.json({ ok: true, adjustment: adjustmentView(row) });
}
