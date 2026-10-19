import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";

/**
 * POST /api/financeiro/bonificacao/pagar — Body: { month, paidAt, ids? }
 *
 * Baixa em lote: marca como pagos, na data informada, os lançamentos ainda
 * pendentes da competência (ou só os `ids`, quando vêm). É o caso comum — a
 * bonificação do mês inteiro sai num mesmo dia, no mês seguinte — e marcar
 * um a um gravava cada um com a data em que a pessoa clicou.
 *
 * Funciona com a competência encerrada: o encerramento congela valores, não o
 * pagamento, que costuma sair depois do fechamento.
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
  if (!agencyId) return NextResponse.json({ error: "Sessão sem empresa vinculada" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const month = String(body?.month ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "Competência inválida" }, { status: 400 });
  }
  const paidAt = body?.paidAt ? new Date(String(body.paidAt)) : null;
  if (!paidAt || isNaN(paidAt.getTime())) {
    return NextResponse.json({ error: "Informe a data do pagamento" }, { status: 400 });
  }
  const ids: string[] | null = Array.isArray(body?.ids) && body.ids.length > 0 ? body.ids.map(String) : null;

  // Só pendentes: quem já está pago mantém a data que tem — reescrever em
  // lote apagaria uma correção feita à mão.
  const r = await prisma.bonus.updateMany({
    where: { companyId: agencyId, month, paidAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { paidAt },
  });

  return NextResponse.json({ pagos: r.count });
}
