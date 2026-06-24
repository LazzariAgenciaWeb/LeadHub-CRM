import { NextRequest, NextResponse } from "next/server";
import { requireInstagramCompany } from "@/lib/instagram-api";
import { prisma } from "@/lib/prisma";

// POST /api/instagram/runs/[id]/convert-lead
// Cria um Lead no CRM (pipeline LEADS) a partir do comentador deste disparo.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;
  const { id } = await params;

  const run = await prisma.igAutomationRun.findUnique({ where: { id } });
  if (!run || run.companyId !== ctx.companyId) {
    return NextResponse.json({ error: "Disparo não encontrado" }, { status: 404 });
  }
  if (run.leadId) {
    return NextResponse.json({ ok: true, leadId: run.leadId, already: true });
  }

  // Primeira etapa configurada do pipeline LEADS (se houver).
  const firstStage = await prisma.pipelineStageConfig.findFirst({
    where: { pipeline: "LEADS", companyId: ctx.companyId },
    orderBy: { order: "asc" },
    select: { name: true },
  });

  const username = run.username || run.igCommenterId;
  const lead = await prisma.lead.create({
    data: {
      name: username,
      phone: "", // não temos telefone do comentário do Instagram
      source: "Instagram",
      instagram: run.username ? `https://instagram.com/${run.username}` : null,
      notes: `Lead do Instagram — comentário: ${JSON.stringify(run.commentText || "")}`,
      companyId: ctx.companyId,
      pipeline: "LEADS",
      pipelineStage: firstStage?.name ?? null,
    },
    select: { id: true },
  });

  await prisma.igAutomationRun.update({ where: { id }, data: { leadId: lead.id } });

  return NextResponse.json({ ok: true, leadId: lead.id });
}
