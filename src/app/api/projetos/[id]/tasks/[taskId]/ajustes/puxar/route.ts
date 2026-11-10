import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { authorizeProjectTask } from "@/lib/project-task-access";
import { sendAdjustments } from "@/lib/approval-adjustments";

// POST /api/projetos/[id]/tasks/[taskId]/ajustes/puxar
// A equipe puxa os ajustes anotados sem esperar o cliente tocar em "Enviar":
// fecha a rodada do mesmo jeito (peça volta pra produção, grupo avisado).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const auth = await authorizeProjectTask(await getEffectiveSession(), id, taskId);
  if (!auth.ok) return auth.response;
  const name = auth.user.name ?? "Equipe";
  const r = await sendAdjustments({ taskId, sender: name, byTeam: { userId: auth.user.id ?? null, name } });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, status: r.status, count: r.count });
}
