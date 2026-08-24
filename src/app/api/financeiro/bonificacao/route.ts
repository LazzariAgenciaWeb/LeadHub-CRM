import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";

/**
 * Bonificação por competência.
 *
 * O que impede pagar duas vezes é a combinação (origem, colaborador, mês):
 * registrar de novo o mesmo contrato pro mesmo colaborador no mesmo mês é
 * recusado. Não dá pra garantir isso por índice único no banco — as duas
 * origens são colunas nulas e Postgres trata NULL como distinto, então dois
 * registros "iguais" passariam pelo unique. A checagem mora aqui.
 */
async function autorizar() {
  const session = await getEffectiveSession();
  if (!session) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const role = (session.user as any)?.role as string;
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  if (!isAdmin && !can(session, "canViewFinanceiro")) {
    return { erro: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  const agencyId = (session.user as any)?.companyId as string | undefined;
  if (!agencyId) {
    return { erro: NextResponse.json({ error: "Sessão sem empresa vinculada" }, { status: 400 }) };
  }
  return { agencyId };
}

const centavos = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// POST /api/financeiro/bonificacao
// Body: { month, saleId? | clientServiceId?, userId? | name, amountCents }
export async function POST(req: NextRequest) {
  const auth = await autorizar();
  if ("erro" in auth) return auth.erro;

  const body = await req.json().catch(() => ({}));
  const month = String(body?.month ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "Competência inválida" }, { status: 400 });
  }

  const saleId = body?.saleId ? String(body.saleId) : null;
  const clientServiceId = body?.clientServiceId ? String(body.clientServiceId) : null;
  if (!saleId && !clientServiceId) {
    return NextResponse.json({ error: "Informe a venda ou o contrato de origem" }, { status: 400 });
  }

  // Origem tem de ser da carteira de quem está logado.
  if (saleId) {
    const s = await prisma.sale.findFirst({ where: { id: saleId, companyId: auth.agencyId }, select: { id: true } });
    if (!s) return NextResponse.json({ error: "Venda não encontrada nesta carteira" }, { status: 400 });
  }
  if (clientServiceId) {
    const cs = await prisma.clientService.findFirst({
      where: { id: clientServiceId, clientCompany: { parentCompanyId: auth.agencyId } },
      select: { id: true },
    });
    if (!cs) return NextResponse.json({ error: "Contrato não encontrado nesta carteira" }, { status: 400 });
  }

  const userId = body?.userId ? String(body.userId) : null;
  let name = String(body?.name ?? "").trim();
  if (userId) {
    // SUPER_ADMIN não atende cliente da agência — fora da lista de bonificáveis.
    const u = await prisma.user.findFirst({
      where: { id: userId, companyId: auth.agencyId, role: { not: "SUPER_ADMIN" } },
      select: { name: true, email: true },
    });
    if (!u) return NextResponse.json({ error: "Colaborador não pertence a esta empresa" }, { status: 400 });
    name = u.name ?? u.email;
  }
  if (!name) return NextResponse.json({ error: "Informe o colaborador" }, { status: 400 });

  const duplicado = await prisma.bonus.findFirst({
    where: { month, saleId, clientServiceId, ...(userId ? { userId } : { name }) },
    select: { id: true, amountCents: true, paidAt: true },
  });
  if (duplicado) {
    return NextResponse.json(
      {
        error: `${name} já tem bonificação registrada nesta origem em ${month}` +
          (duplicado.paidAt ? " (já paga)" : ""),
        existente: duplicado,
      },
      { status: 409 }
    );
  }

  const criado = await prisma.bonus.create({
    data: {
      companyId: auth.agencyId,
      month,
      saleId,
      clientServiceId,
      userId,
      name,
      amountCents: centavos(body?.amountCents),
      notes: body?.notes ? String(body.notes) : null,
    },
  });
  return NextResponse.json(criado, { status: 201 });
}

// PATCH /api/financeiro/bonificacao — Body: { id, amountCents?, paid?, notes? }
export async function PATCH(req: NextRequest) {
  const auth = await autorizar();
  if ("erro" in auth) return auth.erro;

  const body = await req.json().catch(() => ({}));
  const atual = await prisma.bonus.findFirst({
    where: { id: String(body?.id ?? ""), companyId: auth.agencyId },
  });
  if (!atual) return NextResponse.json({ error: "Bonificação não encontrada" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (body?.amountCents !== undefined) data.amountCents = centavos(body.amountCents);
  if (body?.notes !== undefined) data.notes = body.notes ? String(body.notes) : null;
  // A data acompanha o estado: desmarcar limpa, pra não sobrar data de
  // pagamento em bonificação que voltou a pendente.
  if (body?.paid !== undefined) data.paidAt = body.paid ? (atual.paidAt ?? new Date()) : null;

  const atualizado = await prisma.bonus.update({ where: { id: atual.id }, data });
  return NextResponse.json(atualizado);
}

// DELETE /api/financeiro/bonificacao?id=...
export async function DELETE(req: NextRequest) {
  const auth = await autorizar();
  if ("erro" in auth) return auth.erro;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const r = await prisma.bonus.deleteMany({ where: { id, companyId: auth.agencyId } });
  return NextResponse.json({ ok: true, removidos: r.count });
}
