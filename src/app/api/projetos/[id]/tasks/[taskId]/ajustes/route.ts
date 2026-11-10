import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { authorizeProjectTask } from "@/lib/project-task-access";
import { adjustmentView, ADJ_SELECT } from "@/lib/approval-adjustments";

// GET /api/projetos/[id]/tasks/[taskId]/ajustes
// Ajustes que o cliente pediu no link de aprovação, todas as rodadas (a mais
// recente primeiro). Os ainda não enviados aparecem como "anotados": a equipe
// já enxerga enquanto o cliente escreve.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const auth = await authorizeProjectTask(await getEffectiveSession(), id, taskId);
  if (!auth.ok) return auth.response;
  const rows = await prisma.projectTaskAdjustment.findMany({
    where:   { taskId },
    orderBy: [{ round: "desc" }, { createdAt: "asc" }],
    select:  ADJ_SELECT,
  });
  return NextResponse.json({ round: auth.task.approvalRound, status: auth.task.status, items: rows.map(adjustmentView) });
}
