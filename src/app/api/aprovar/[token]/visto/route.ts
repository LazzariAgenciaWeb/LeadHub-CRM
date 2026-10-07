import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/aprovar/[token]/visto — o cliente abriu o link nesta rodada.
// Chamado pelo navegador (JS), nunca no render: o robô de prévia do WhatsApp
// abre o link assim que a mensagem sai e marcaria "visto" sozinho.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const task = await prisma.projectTask.findUnique({
    where:  { approvalToken: token },
    select: { id: true, projectId: true, status: true, approvalViewedAt: true, approvalRound: true },
  });
  if (!task) return NextResponse.json({ ok: false }, { status: 404 });
  if (task.status !== "AGUARDANDO_CLIENTE" || task.approvalViewedAt) return NextResponse.json({ ok: true });

  const r = await prisma.projectTask.updateMany({
    where: { id: task.id, approvalViewedAt: null },
    data:  { approvalViewedAt: new Date() },
  });
  if (r.count) {
    await prisma.projectTaskEvent.create({
      data: { taskId: task.id, projectId: task.projectId, type: "APPROVAL_VIEWED", toText: `Rodada ${task.approvalRound}`, byClient: true },
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
