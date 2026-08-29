import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";

/**
 * POST /api/financeiro/bonificacao/lote
 * Body: { serviceIds: string[], bonusEligible: boolean }
 *
 * Liga/desliga a flag de bonificação de VÁRIOS serviços contratados de uma
 * vez — o caso "hospedagem não bonifica" são dezenas de contratos, e marcar
 * um a um é exatamente o retrabalho que a flag veio eliminar.
 */
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any)?.role as string;
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  if (!isAdmin && !can(session, "canViewFinanceiro")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  const agencyId = (session.user as any)?.companyId as string | undefined;
  const isGlobal = role === "SUPER_ADMIN" && !agencyId;

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.serviceIds) ? body.serviceIds.map(String).slice(0, 500) : [];
  if (ids.length === 0) return NextResponse.json({ error: "Nenhum serviço informado" }, { status: 400 });
  const flag = !!body?.bonusEligible;

  // Só serviços da própria carteira — ids de fora são silenciosamente
  // descartados pelo where, nunca atualizados.
  const escopo = isGlobal
    ? { clientCompany: { parentCompanyId: { not: null } } }
    : { clientCompany: { parentCompanyId: agencyId } };

  const alvo = await prisma.clientService.findMany({
    where: { id: { in: ids }, ...escopo },
    select: { id: true, label: true, clientCompanyId: true },
  });
  if (alvo.length === 0) return NextResponse.json({ updated: 0 });

  const r = await prisma.clientService.updateMany({
    where: { id: { in: alvo.map((a) => a.id) } },
    data: { bonusEligible: flag },
  });

  const userName = (session.user as any)?.name ?? (session.user as any)?.email ?? null;
  await prisma.financeLog
    .createMany({
      data: alvo.map((a) => ({
        companyId: agencyId ?? "GLOBAL",
        clientCompanyId: a.clientCompanyId,
        entity: "CONTRATO",
        entityId: a.id,
        action: "ALTERADO",
        description: flag ? "Voltou a gerar bonificação (lote)" : "Marcado como não bonifica (lote)",
        meta: { contrato: a.label, bonusEligible: flag },
        userName,
      })),
    })
    .catch((e) => console.error("[finance-log bonifica-lote]", e));

  return NextResponse.json({ updated: r.count });
}
