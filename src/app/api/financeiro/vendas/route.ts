import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { logFinance } from "@/lib/finance-log";

/**
 * POST /api/financeiro/vendas — venda MANUAL na esteira.
 * Body: { title, valueCents, kind?, closedAt?, clientCompanyId?, notes? }
 *
 * A esteira nasce do CRM (lead ganho → venda), mas o trabalho que já estava
 * em aberto ANTES do sistema não tem lead nenhum — sem entrada manual, essa
 * migração ficava de fora do fechamento e da bonificação pra sempre.
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
  if (!agencyId) {
    return NextResponse.json({ error: "Sessão sem empresa vinculada" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const title = String(body?.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "Dê um nome à venda" }, { status: 400 });

  const valueCents = Math.round(Number(body?.valueCents));
  if (!Number.isFinite(valueCents) || valueCents < 0) {
    return NextResponse.json({ error: "Valor inválido" }, { status: 400 });
  }

  const kind = body?.kind === "RECORRENTE" ? "RECORRENTE" : "PONTUAL";
  const closed = body?.closedAt ? new Date(String(body.closedAt)) : new Date();
  const closedAt = Number.isNaN(closed.getTime()) ? new Date() : closed;

  // Cliente é opcional na criação (dá pra vincular depois na própria esteira),
  // mas quando vem tem de ser da carteira.
  let clientCompanyId: string | null = null;
  if (body?.clientCompanyId) {
    const c = await prisma.company.findFirst({
      where: { id: String(body.clientCompanyId), parentCompanyId: agencyId },
      select: { id: true },
    });
    if (!c) return NextResponse.json({ error: "Cliente não encontrado nesta carteira" }, { status: 400 });
    clientCompanyId = c.id;
  }

  const created = await prisma.sale.create({
    data: {
      companyId: agencyId,
      title,
      valueCents,
      kind,
      closedAt,
      clientCompanyId,
      sellerName: (session.user as any)?.name ?? null,
      notes: body?.notes ? String(body.notes) : null,
    },
    include: { clientCompany: { select: { id: true, name: true } } },
  });

  await logFinance({
    companyId: agencyId,
    clientCompanyId,
    entity: "CONTRATO",
    entityId: created.id,
    action: "CRIADO",
    description: "Venda adicionada manualmente na esteira",
    meta: { venda: title, valorCents: valueCents, tipo: kind },
    session,
  });

  return NextResponse.json(created, { status: 201 });
}
