import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { findOrCreateClientCompany } from "@/lib/client-company";
import { can } from "@/lib/permissions";

const CONTRACT = ["PENDENTE", "ENVIADO", "ASSINADO", "DISPENSADO"];
const BILLING = ["PENDENTE", "FATURADO", "DISPENSADO"];
const PRODUCTION = ["PENDENTE", "LIBERADO", "ENTREGUE", "DISPENSADO"];

/**
 * A data do checkpoint acompanha o status: sair de PENDENTE carimba agora,
 * voltar pra PENDENTE limpa. Guardar uma data de "contrato assinado" numa
 * venda cujo contrato voltou a pendente seria mentira silenciosa nos relatórios.
 */
function stamp(next: string | undefined, current: string, at: Date | null) {
  if (next === undefined || next === current) return {};
  return next === "PENDENTE" ? { at: null } : { at: at ?? new Date() };
}

// PATCH /api/financeiro/vendas/[id]
// Body: { contractStatus?, billingStatus?, productionStatus?,
//         clientCompanyId?, newClientName?, kind?, notes? }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // Atendente de um setor com Financeiro liberado também opera aqui — é quem
  // dá baixa em cobrança e marca a esteira no dia a dia.
  const role = (session.user as any)?.role as string;
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  if (!isAdmin && !can(session, "canViewFinanceiro")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  const agencyId = (session.user as any)?.companyId as string | undefined;

  const { id } = await params;
  const sale = await prisma.sale.findUnique({ where: { id } });
  if (!sale) return NextResponse.json({ error: "Venda não encontrada" }, { status: 404 });

  // A venda é da agência. SUPER_ADMIN sem empresa própria enxerga todas.
  if (role !== "SUPER_ADMIN" && sale.companyId !== agencyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  const contractStatus = body?.contractStatus as string | undefined;
  const billingStatus = body?.billingStatus as string | undefined;
  const productionStatus = body?.productionStatus as string | undefined;

  if (contractStatus !== undefined) {
    if (!CONTRACT.includes(contractStatus)) return NextResponse.json({ error: "Status de contrato inválido" }, { status: 400 });
    data.contractStatus = contractStatus;
    const s = stamp(contractStatus, sale.contractStatus, sale.contractAt);
    if ("at" in s) data.contractAt = s.at;
  }
  if (billingStatus !== undefined) {
    if (!BILLING.includes(billingStatus)) return NextResponse.json({ error: "Status de faturamento inválido" }, { status: 400 });
    data.billingStatus = billingStatus;
    const s = stamp(billingStatus, sale.billingStatus, sale.billedAt);
    if ("at" in s) data.billedAt = s.at;
  }
  if (productionStatus !== undefined) {
    if (!PRODUCTION.includes(productionStatus)) return NextResponse.json({ error: "Status de produção inválido" }, { status: 400 });
    data.productionStatus = productionStatus;
    // Duas datas, porque respondem perguntas diferentes: quando saiu pra
    // produção e quando chegou ao cliente. A segunda é a que conta pro
    // fechamento de bonificação.
    if (productionStatus === "PENDENTE") {
      data.releasedAt = null;
      data.deliveredAt = null;
    } else {
      if (!sale.releasedAt) data.releasedAt = new Date();
      data.deliveredAt = productionStatus === "ENTREGUE" ? (sale.deliveredAt ?? new Date()) : null;
    }
  }

  if (body?.kind !== undefined) {
    if (!["PONTUAL", "RECORRENTE"].includes(body.kind)) {
      return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
    }
    data.kind = body.kind;
  }
  if (body?.notes !== undefined) data.notes = body.notes ? String(body.notes) : null;
  // Entra ou não no fechamento de bonificação — mesma flag do serviço
  // contratado, marcada direto na lista de pontuais da aba Bonificação.
  if (body?.bonusEligible !== undefined) data.bonusEligible = !!body.bonusEligible;

  // ── Vínculo com o cliente ────────────────────────────────────────────────
  // Duas formas: apontar pra um cliente que já existe, ou cadastrar um novo
  // pelo nome. A agência dona é sempre a da venda, nunca a do corpo da request.
  const ownerId = sale.companyId;

  if (body?.newClientName) {
    const name = String(body.newClientName).trim();
    if (!name) return NextResponse.json({ error: "Informe o nome do cliente" }, { status: 400 });
    data.clientCompanyId = await findOrCreateClientCompany({ name, parentCompanyId: ownerId });
  } else if (body?.clientCompanyId !== undefined) {
    if (body.clientCompanyId === null) {
      data.clientCompanyId = null;
    } else {
      const target = await prisma.company.findFirst({
        where: { id: String(body.clientCompanyId), parentCompanyId: ownerId },
        select: { id: true },
      });
      if (!target) {
        return NextResponse.json({ error: "Cliente não pertence a esta carteira" }, { status: 400 });
      }
      data.clientCompanyId = target.id;
    }
  }

  const updated = await prisma.sale.update({
    where: { id },
    data,
    include: { clientCompany: { select: { id: true, name: true } } },
  });

  // ── Faturar gera cobrança de verdade ─────────────────────────────────────
  // Sem isso, "Faturado" na esteira era só um checkbox: a venda não entrava em
  // "Já faturado" nem na barra da meta (que somam ClientInvoice), então venda
  // pontual ficava invisível no financeiro por mais que estivesse faturada.
  //
  // Recorrente continua vindo do contrato (clientServiceId) — aqui é só o
  // avulso da esteira. O vínculo é 1:1 via saleId (unique), então remarcar
  // "Faturado" não duplica.
  let invoice = null;

  // Desfazer: marcou faturado por engano e voltou atrás. Remove a cobrança
  // gerada — mas só se ainda estiver ABERTO. Cobrança já paga permanece:
  // apagar registro de dinheiro que entrou seria pior que a inconsistência.
  if (
    billingStatus !== undefined &&
    billingStatus !== "FATURADO" &&
    sale.billingStatus === "FATURADO"
  ) {
    await prisma.clientInvoice.deleteMany({ where: { saleId: id, status: "ABERTO" } });
  }

  if (billingStatus === "FATURADO" && sale.billingStatus !== "FATURADO") {
    const clientId = (data.clientCompanyId as string | undefined) ?? updated.clientCompanyId;
    if (!clientId) {
      // A venda foi marcada como faturada, mas não tem pra quem cobrar. Não
      // desfazemos o status — o usuário vê o aviso e vincula o cliente.
      return NextResponse.json({
        ...updated,
        warning: "Venda marcada como faturada, mas sem cliente vinculado — a cobrança não foi criada. Vincule um cliente e marque novamente.",
      });
    }

    const existing = await prisma.clientInvoice.findUnique({ where: { saleId: id } });
    if (!existing) {
      // Vencimento: o que veio no corpo, ou +7 dias como default de trabalho.
      const due = body?.dueDate ? new Date(String(body.dueDate)) : null;
      const dueDate = due && !isNaN(due.getTime())
        ? due
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Competência = mês do fechamento da venda, não o de hoje. Venda de
      // julho faturada em agosto pertence a julho nos relatórios.
      const ref = updated.closedAt;
      const referenceMonth = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;

      invoice = await prisma.clientInvoice.create({
        data: {
          clientCompanyId: clientId,
          saleId: id,
          description: updated.title,
          amountCents: updated.valueCents,
          dueDate,
          referenceMonth,
          status: "ABERTO",
          provider: "manual",
        },
        select: { id: true, amountCents: true, dueDate: true, status: true },
      });
    }
  }

  return NextResponse.json({ ...updated, invoice });
}

// DELETE /api/financeiro/vendas/[id]
//
// Remove a venda da esteira. Existe porque a remoção automática
// (removeSaleIfUntouched) só age na reabertura do lead e só quando ninguém
// encostou na venda — sem isso, entrada indevida (lead marcado como ganho por
// engano, teste, duplicata) ficava presa na esteira pra sempre.
//
// Não mexe no lead: excluir da esteira é decisão do Financeiro, não do CRM. Se
// o lead continuar numa etapa de ganho, um novo PATCH nele recria a venda —
// comportamento desejado, já que o CRM segue sendo a fonte da verdade.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any)?.role as string;
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  if (!isAdmin && !can(session, "canViewFinanceiro")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  const agencyId = (session.user as any)?.companyId as string | undefined;

  const { id } = await params;
  const sale = await prisma.sale.findUnique({
    where: { id },
    select: { id: true, companyId: true },
  });
  if (!sale) return NextResponse.json({ error: "Venda não encontrada" }, { status: 404 });

  if (role !== "SUPER_ADMIN" && sale.companyId !== agencyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  // Bonus tem FK pra Sale — apaga junto pra não deixar bonificação órfã
  // apontando pra venda inexistente.
  await prisma.$transaction([
    prisma.bonus.deleteMany({ where: { saleId: id } }),
    prisma.sale.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true });
}
