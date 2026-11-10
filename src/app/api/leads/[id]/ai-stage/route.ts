import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { analyzeLeadStage, applyStageSuggestion, dismissStageSuggestion } from "@/lib/lead-stage-ai";

/**
 * POST /api/leads/[id]/ai-stage  { action: "analyze" | "apply" | "dismiss" }
 *
 * analyze → IA lê a conversa agora e grava a sugestão (consome 1 da cota de IA)
 * apply   → aplica a etapa/retorno sugeridos (mesmo caminho do Kanban: histórico,
 *           ClickUp, venda, gamificação)
 * dismiss → descarta a sugestão
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const lead = await prisma.lead.findUnique({ where: { id }, select: { companyId: true } });
  if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN" && lead.companyId !== (session.user as any).companyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { action } = await req.json().catch(() => ({}));
  const actor = { id: (session.user as any).id as string | undefined, name: session.user?.name ?? null };

  if (action === "analyze") {
    const r = await analyzeLeadStage(id, { userId: actor.id ?? null });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  } else if (action === "apply") {
    const r = await applyStageSuggestion(id, actor);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  } else if (action === "dismiss") {
    await dismissStageSuggestion(id);
  } else {
    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  }

  const fresh = await prisma.lead.findUnique({
    where: { id },
    select: {
      pipelineStage: true, status: true, expectedReturnAt: true,
      aiStageSuggestion: true, aiStageReason: true, aiStageConfidence: true,
      aiStageReturnAt: true, aiStageAnalyzedAt: true,
    },
  });
  return NextResponse.json({ ok: true, lead: fresh });
}
