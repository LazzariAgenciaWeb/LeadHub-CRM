import { NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getLeadFollowUps } from "@/lib/calendar-data";

/**
 * GET /api/followups/me
 *
 * Buckets de follow-up do usuário logado pra o widget do dashboard:
 *   - leadsFollowUp → leads/oportunidades com prazo de retorno vencido/hoje
 *   - staleLeads    → leads sem prazo, esfriando (sem interação há N dias)
 *
 * Mesmo escopo do "Meu Dia": meus + sem responsável (manager vê qualquer setor,
 * CLIENT só os seus). Fonte única em getLeadFollowUps().
 */
export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId   = (session.user as any).id as string;
  const role     = (session.user as any).role as string;
  const companyId = (session.user as any).companyId as string | undefined;
  const isManager = role === "SUPER_ADMIN" || role === "ADMIN";

  const userSetorIds = isManager
    ? []
    : (await prisma.setorUser.findMany({
        where: { userId },
        select: { setorId: true },
      })).map((s) => s.setorId);

  const data = await getLeadFollowUps({ companyId, userId, isManager, userSetorIds });
  return NextResponse.json(data);
}
