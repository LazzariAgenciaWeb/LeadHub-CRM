import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// PATCH /api/pipeline/stages/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { name, color, order, isFinal, outcome } = body;

  // GANHO/PERDIDO são sempre etapas de encerramento — força isFinal=true quando
  // o outcome muda pra um deles. Voltar pra NEUTRO não mexe em isFinal (uma etapa
  // pode ser final sem ser ganho/perdido — ex: "Resolvido" em Chamados).
  const outcomeValid = outcome === "NEUTRO" || outcome === "GANHO" || outcome === "PERDIDO";
  const forcedFinal = outcomeValid && outcome !== "NEUTRO";

  const stage = await prisma.pipelineStageConfig.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(color !== undefined && { color }),
      ...(order !== undefined && { order }),
      ...(isFinal !== undefined && { isFinal }),
      ...(outcomeValid && { outcome }),
      ...(forcedFinal && { isFinal: true }),
    },
  });

  return NextResponse.json(stage);
}

// DELETE /api/pipeline/stages/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  await prisma.pipelineStageConfig.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
