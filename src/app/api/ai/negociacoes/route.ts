import { NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { getLeadFollowUps } from "@/lib/calendar-data";

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

// GET /api/ai/negociacoes  → negociações que precisam de ação (retorno vencido +
// esfriando), enriquecidas com o resumo da qualificação. Diagnóstico determinístico
// (sem custo de IA); o follow-up por IA é gerado individualmente sob demanda.
export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "ai");
  if (!gate.ok) return gate.response;

  const userId = (session.user as any).id as string;
  const role = (session.user as any).role as string;
  const companyId = (session.user as any).companyId as string | undefined;
  const isManager = role === "SUPER_ADMIN" || role === "ADMIN";

  const userSetorIds = isManager
    ? []
    : (await prisma.setorUser.findMany({ where: { userId }, select: { setorId: true } })).map((s) => s.setorId);

  const data = await getLeadFollowUps({ companyId, userId, isManager, userSetorIds });

  const ids = [...data.leadsFollowUp, ...data.staleLeads].map((l) => l.id);
  const notesRows = ids.length
    ? await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, notes: true } })
    : [];
  const resumoById = new Map(notesRows.map((r) => [r.id, extractResumo(r.notes)]));

  return NextResponse.json({
    leadsFollowUp: data.leadsFollowUp.map((l) => ({ ...l, resumo: resumoById.get(l.id) ?? null })),
    staleLeads: data.staleLeads.map((l) => ({ ...l, resumo: resumoById.get(l.id) ?? null })),
  });
}
