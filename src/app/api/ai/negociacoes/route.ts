import { NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { NOT_CLOSED_LEAD_WHERE, FOLLOWUP_PIPELINES, STALE_AFTER_DAYS } from "@/lib/calendar-data";

// Extrai um resumo curto do bloco "[Qualificação IA]" gravado em Lead.notes
// (Bloco B). Mostra "o que é o contato" sem custo de IA.
function extractResumo(notes: string | null): string | null {
  if (!notes) return null;
  const block = notes.match(/\[Qualificação IA\]([\s\S]*?)\[\/Qualificação IA\]/);
  const scope = block ? block[1] : notes;
  const resumo = scope.match(/Resumo:\s*(.+)/i)?.[1]?.trim();
  if (resumo) return resumo;
  const servico = scope.match(/Serviço de interesse:\s*(.+)/i)?.[1]?.trim();
  return servico ? `Interesse: ${servico}` : null;
}

// Oportunidades primeiro (mais importantes), depois leads.
function pipelineRank(p: string | null): number {
  return p === "OPORTUNIDADES" ? 0 : 1;
}

// GET /api/ai/negociacoes  → negociações (LEADS + OPORTUNIDADES) que precisam de
// ação. Diferente do widget "Meu Dia": é o cockpit COMERCIAL — gestor vê a
// empresa toda, oportunidades aparecem mesmo sem conversa vinculada e vêm
// priorizadas. Diagnóstico determinístico (sem custo de IA).
export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "ai");
  if (!gate.ok) return gate.response;

  const userId = (session.user as any).id as string;
  const role = (session.user as any).role as string;
  const companyId = (session.user as any).companyId as string | undefined;
  const isManager = role === "SUPER_ADMIN" || role === "ADMIN";

  const now = new Date();
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
  const staleCutoff = new Date(now); staleCutoff.setDate(staleCutoff.getDate() - STALE_AFTER_DAYS);

  const cf = companyId ? { companyId } : {};

  // Etapas finais (isFinal) — encerradas, sem follow-up.
  const finalStageRows = companyId
    ? await prisma.pipelineStageConfig.findMany({ where: { companyId, isFinal: true }, select: { name: true } })
    : [];
  const notFinalStage = finalStageRows.length
    ? { pipelineStage: { notIn: finalStageRows.map((s) => s.name) } }
    : {};

  // Escopo: gestor vê a empresa toda; atendente vê os seus + sem responsável do
  // seu setor. Oportunidades SEM conversa entram (não exigimos vínculo aqui).
  let scopeFilter: any = {};
  if (!isManager) {
    const userSetorIds = (await prisma.setorUser.findMany({ where: { userId }, select: { setorId: true } }))
      .map((s) => s.setorId);
    const scopeOr: any[] = [{ conversation: { is: { assigneeId: userId } } }];
    if (userSetorIds.length) {
      scopeOr.push({ conversation: { is: { assigneeId: null, setorId: { in: userSetorIds } } } });
    }
    scopeFilter = { OR: scopeOr };
  }

  const baseWhere = {
    ...cf,
    ...NOT_CLOSED_LEAD_WHERE,
    ...notFinalStage,
    pipeline: { in: FOLLOWUP_PIPELINES as any },
    ...scopeFilter,
  };

  const [overdueRaw, staleRaw] = await Promise.all([
    // Retorno vencido/hoje
    prisma.lead.findMany({
      where: { ...baseWhere, expectedReturnAt: { lte: todayEnd } },
      select: {
        id: true, name: true, phone: true, companyId: true,
        pipeline: true, pipelineStage: true, status: true, notes: true,
        expectedReturnAt: true,
      },
      orderBy: { expectedReturnAt: "asc" },
      take: 40,
    }),
    // Esfriando: sem prazo + (conversa parada OU sem conversa e atualizado há tempo)
    prisma.lead.findMany({
      where: {
        ...baseWhere,
        expectedReturnAt: null,
        OR: [
          { conversation: { is: { lastMessageAt: { lt: staleCutoff } } } },
          { AND: [{ conversation: { is: null } }, { updatedAt: { lt: staleCutoff } }] },
        ],
      },
      select: {
        id: true, name: true, phone: true, companyId: true,
        pipeline: true, pipelineStage: true, status: true, notes: true,
        updatedAt: true,
        conversation: { select: { lastMessageAt: true } },
      },
      orderBy: { updatedAt: "asc" },
      take: 30,
    }),
  ]);

  // Oportunidades primeiro em cada bucket.
  const sortByPriority = <T extends { pipeline: string | null }>(arr: T[]) =>
    [...arr].sort((a, b) => pipelineRank(a.pipeline) - pipelineRank(b.pipeline));

  const mapItem = (l: any) => {
    const { notes, ...rest } = l;
    return { ...rest, resumo: extractResumo(notes) };
  };

  return NextResponse.json({
    leadsFollowUp: sortByPriority(overdueRaw).map(mapItem),
    staleLeads: sortByPriority(staleRaw).map(mapItem),
  });
}
