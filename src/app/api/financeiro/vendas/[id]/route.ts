import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { findOrCreateClientCompany } from "@/lib/client-company";
import { can } from "@/lib/permissions";
import { logFinance } from "@/lib/finance-log";
import { moverBonificacaoDaVenda, competencia, type ResultadoRedatacao } from "@/lib/sale-delivery";

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
// Body: { contractStatus?, billingStatus?, productionStatus?, deliveredAt?,
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

  // Data de entrega editável. A automática é o dia em que se marca "Entregue",
  // e marcar atrasado é rotina — entrega feita em agosto registrada em
  // setembro. Como é a data que decide a competência da bonificação do
  // pontual, precisa dar pra corrigir.
  if (body?.deliveredAt !== undefined) {
    const statusFinal = productionStatus ?? sale.productionStatus;
    if (statusFinal !== "ENTREGUE") {
      return NextResponse.json({ error: "Só dá pra definir data de entrega em venda marcada como Entregue" }, { status: 400 });
    }
    const d = new Date(String(body.deliveredAt));
    if (!body.deliveredAt || Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "Data de entrega inválida" }, { status: 400 });
    }
    // Entrega no futuro é quase sempre erro de digitação (ano trocado) e
    // jogaria a bonificação num mês que ainda nem fechou.
    if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      return NextResponse.json({ error: "A data de entrega não pode estar no futuro" }, { status: 400 });
    }
    data.deliveredAt = d;
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

  // ── Projeto que entrega esta venda ───────────────────────────────────────
  // Duas formas, como no vínculo de cliente: apontar pra um projeto que já
  // existe, ou criar um novo já amarrado ao cliente da venda. O detalhe do
  // trabalho vive lá; aqui fica só o elo pra acompanhar e, na entrega,
  // bonificar.
  if (body?.projectId !== undefined) {
    if (!body.projectId) {
      data.projectId = null;
    } else {
      const p = await prisma.setorClickupList.findFirst({
        where: { id: String(body.projectId), setor: { companyId: sale.companyId } },
        select: { id: true },
      });
      if (!p) return NextResponse.json({ error: "Projeto não encontrado nesta empresa" }, { status: 400 });
      data.projectId = p.id;
    }
  } else if (body?.newProjectName) {
    const nome = String(body.newProjectName).trim();
    if (!nome) return NextResponse.json({ error: "Dê um nome ao projeto" }, { status: 400 });

    // Setor: o informado, ou o primeiro da empresa. Projeto precisa de setor,
    // e exigir essa escolha aqui travaria o fluxo da esteira por um detalhe
    // que se ajusta depois, dentro do projeto.
    const setor = body?.setorId
      ? await prisma.setor.findFirst({
          where: { id: String(body.setorId), companyId: sale.companyId },
          select: { id: true },
        })
      : await prisma.setor.findFirst({
          where: { companyId: sale.companyId },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
    if (!setor) {
      return NextResponse.json(
        { error: "Nenhum setor cadastrado — crie um setor antes de abrir projetos." },
        { status: 400 },
      );
    }

    const criado = await prisma.setorClickupList.create({
      data: {
        setorId: setor.id,
        name: nome,
        clientCompanyId: (data.clientCompanyId as string | undefined) ?? sale.clientCompanyId,
        // Entra já em produção: o gatilho de criar foi liberar a produção.
        status: "EM_ANDAMENTO",
        description: `Entrega da venda "${sale.title}" (${(sale.valueCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).`,
      },
      select: { id: true },
    });
    data.projectId = criado.id;
  }

  // Responsável pela execução — quem entrega e bonifica. Vazio/null limpa.
  if (body?.responsibleUserId !== undefined) {
    if (!body.responsibleUserId) {
      data.responsibleId = null;
      data.responsibleName = null;
    } else {
      const u = await prisma.user.findFirst({
        // SUPER_ADMIN é dono da plataforma, não executa serviço de cliente.
        where: { id: String(body.responsibleUserId), companyId: sale.companyId, role: { not: "SUPER_ADMIN" } },
        select: { id: true, name: true, email: true },
      });
      if (!u) return NextResponse.json({ error: "Colaborador não pertence a esta empresa" }, { status: 400 });
      data.responsibleId = u.id;
      data.responsibleName = u.name ?? u.email;
    }
  }

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
    include: {
      clientCompany: { select: { id: true, name: true } },
      project: { select: { id: true, name: true, status: true, taskCount: true, taskCompleted: true } },
    },
  });

  // ── Data de entrega mudou de mês → bonificação acompanha ─────────────────
  // Ver src/lib/sale-delivery.ts: move os lançamentos não pagos pra nova
  // competência; os pagos ficam onde saíram.
  let bonificacao: ResultadoRedatacao | undefined;
  if (data.deliveredAt instanceof Date) {
    bonificacao = await moverBonificacaoDaVenda(id, sale.deliveredAt, data.deliveredAt);
    const mesAntigo = sale.deliveredAt ? competencia(sale.deliveredAt) : null;
    const mesNovo = competencia(data.deliveredAt);

    await logFinance({
      companyId: sale.companyId,
      clientCompanyId: updated.clientCompanyId,
      entity: "COBRANCA",
      entityId: null,
      action: "ENTREGA_REDATADA",
      description: `Data de entrega da venda alterada${mesAntigo && mesAntigo !== mesNovo ? ` (${mesAntigo} → ${mesNovo})` : ""}`,
      meta: {
        venda: sale.title,
        de: sale.deliveredAt?.toISOString() ?? null,
        para: data.deliveredAt.toISOString(),
        ...(bonificacao ?? {}),
      },
      session,
    });
  }

  // ── Faturar gera cobrança de verdade ─────────────────────────────────────
  // Sem isso, "Faturado" na esteira era só um checkbox: a venda não entrava em
  // "Já faturado" nem na barra da meta (que somam ClientInvoice), então venda
  // pontual ficava invisível no financeiro por mais que estivesse faturada.
  //
  // Recorrente continua vindo do contrato (clientServiceId) — aqui é só o
  // avulso da esteira. Venda parcelada gera uma cobrança por parcela; a trava
  // contra duplicar é criar só quando a venda ainda não tem cobrança nenhuma.
  let invoices: { id: string; amountCents: number; dueDate: Date; status: string; installment: number | null }[] = [];

  // Desfazer: marcou faturado por engano e voltou atrás. Remove a cobrança
  // gerada — mas só se ainda estiver ABERTO. Cobrança já paga permanece:
  // apagar registro de dinheiro que entrou seria pior que a inconsistência.
  if (
    billingStatus !== undefined &&
    billingStatus !== "FATURADO" &&
    sale.billingStatus === "FATURADO"
  ) {
    const undone = await prisma.clientInvoice.deleteMany({ where: { saleId: id, status: "ABERTO" } });
    if (undone.count > 0) {
      await logFinance({
        companyId: sale.companyId,
        clientCompanyId: sale.clientCompanyId,
        entity: "COBRANCA",
        entityId: null,
        action: "EXCLUIDO",
        description: "Desfeito o 'Faturado' da venda na esteira",
        meta: { venda: sale.title, valorCents: sale.valueCents },
        session,
      });
    }
  }

  if (billingStatus === "FATURADO" && sale.billingStatus !== "FATURADO") {
    const clientId = (data.clientCompanyId as string | undefined) ?? updated.clientCompanyId;
    if (!clientId) {
      // A venda foi marcada como faturada, mas não tem pra quem cobrar. Não
      // desfazemos o status — o usuário vê o aviso e vincula o cliente.
      return NextResponse.json({
        ...updated,
        bonificacao,
        warning: "Venda marcada como faturada, mas sem cliente vinculado — a cobrança não foi criada. Vincule um cliente e marque novamente.",
      });
    }

    const jaTem = await prisma.clientInvoice.count({ where: { saleId: id } });
    if (jaTem === 0) {
      // Vencimento da 1ª parcela: o que veio no corpo, ou +7 dias como default.
      const due = body?.dueDate ? new Date(String(body.dueDate)) : null;
      const primeiroVenc = due && !isNaN(due.getTime())
        ? due
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const n = Math.min(Math.max(parseInt(String(body?.parcelas ?? 1), 10) || 1, 1), 60);

      // Divisão sem perder centavo: as parcelas recebem o piso e a PRIMEIRA
      // absorve a sobra. R$ 2.850 em 2x = 1.425 + 1.425; R$ 1.000 em 3x =
      // 333,34 + 333,33 + 333,33 — a soma continua batendo com a venda.
      const base = Math.floor(updated.valueCents / n);
      const sobra = updated.valueCents - base * n;

      const parcelas = Array.from({ length: n }, (_, i) => {
        // Vencimento mensal a partir do primeiro. Dia 31 em mês curto cai no
        // último dia do mês, em vez de vazar pro mês seguinte.
        const venc = new Date(primeiroVenc);
        const diaAlvo = primeiroVenc.getDate();
        venc.setDate(1);
        venc.setMonth(venc.getMonth() + i);
        const ultimoDia = new Date(venc.getFullYear(), venc.getMonth() + 1, 0).getDate();
        venc.setDate(Math.min(diaAlvo, ultimoDia));

        return {
          clientCompanyId: clientId,
          saleId: id,
          description: n > 1 ? `${updated.title} (${i + 1}/${n})` : updated.title,
          amountCents: base + (i === 0 ? sobra : 0),
          dueDate: venc,
          // Competência de CADA parcela = o mês em que ela vence. Jogar as 12
          // no mês do fechamento faria setembro mostrar R$ 18 mil faturados e
          // os outros 11 meses vazios — o oposto da leitura de caixa.
          referenceMonth: `${venc.getFullYear()}-${String(venc.getMonth() + 1).padStart(2, "0")}`,
          status: "ABERTO",
          provider: "manual",
          installment: n > 1 ? i + 1 : null,
          installments: n > 1 ? n : null,
        };
      });

      await prisma.clientInvoice.createMany({ data: parcelas });
      invoices = await prisma.clientInvoice.findMany({
        where: { saleId: id },
        orderBy: { dueDate: "asc" },
        select: { id: true, amountCents: true, dueDate: true, status: true, installment: true },
      });

      await logFinance({
        companyId: sale.companyId,
        clientCompanyId: clientId,
        entity: "COBRANCA",
        entityId: invoices[0]?.id ?? null,
        action: "FATURADO",
        description: n > 1
          ? `Venda faturada na esteira em ${n} parcelas`
          : "Venda marcada como Faturado na esteira",
        meta: { venda: updated.title, valorCents: updated.valueCents, parcelas: n },
        session,
      });
    }
  }

  return NextResponse.json({ ...updated, invoices, bonificacao });
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
