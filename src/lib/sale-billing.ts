/**
 * Faturamento da venda na esteira quando a cobrança JÁ EXISTE no cliente.
 *
 * "Faturado" na esteira sempre criava uma cobrança nova. Só que a cobrança
 * muitas vezes já está na conta do cliente — lançada à mão, vinda do Bling ou
 * de uma importação — e criar outra duplica o faturamento do mês. Aqui a
 * venda passa a poder ADOTAR cobranças existentes em vez de gerar.
 */

import { prisma } from "./prisma";
import { logFinance } from "./finance-log";

export class BillingLinkError extends Error {}

/** Ação do FinanceLog que marca "esta cobrança foi vinculada, não criada pela venda". */
const LINKED = "VINCULADA";

/**
 * Cobranças do cliente que podem ser ligadas a uma venda: não canceladas e
 * ainda sem venda. As de valor igual ao da venda vêm primeiro — é quase
 * sempre a que se procura.
 */
export async function invoiceCandidates(sale: { clientCompanyId: string | null; valueCents: number }) {
  if (!sale.clientCompanyId) return [];
  const rows = await prisma.clientInvoice.findMany({
    where: { clientCompanyId: sale.clientCompanyId, saleId: null, status: { not: "CANCELADO" } },
    orderBy: { dueDate: "desc" },
    take: 60,
    select: {
      id: true, description: true, amountCents: true, dueDate: true, status: true, paidAt: true,
      referenceMonth: true, provider: true, installment: true, installments: true,
      clientService: { select: { label: true } },
    },
  });
  return rows
    .map((r) => ({
      id: r.id,
      description: r.description,
      amountCents: r.amountCents,
      dueDate: r.dueDate.toISOString(),
      status: r.status,
      paidAt: r.paidAt?.toISOString() ?? null,
      referenceMonth: r.referenceMonth,
      provider: r.provider,
      parcela: r.installment && r.installments ? `${r.installment}/${r.installments}` : null,
      contrato: r.clientService?.label ?? null,
      mesmoValor: r.amountCents === sale.valueCents,
    }))
    .sort((a, b) => Number(b.mesmoValor) - Number(a.mesmoValor));
}

/**
 * Liga cobranças existentes à venda. Só aceita cobrança do MESMO cliente,
 * não cancelada e sem venda — qualquer id fora disso recusa a operação
 * inteira, pra não ligar pela metade.
 */
export async function linkInvoicesToSale(
  sale: { id: string; companyId: string; title: string; valueCents: number },
  clientCompanyId: string,
  invoiceIds: string[],
  session: any,
) {
  const ids = [...new Set(invoiceIds.map(String))].slice(0, 60);
  if (ids.length === 0) throw new BillingLinkError("Escolha ao menos uma cobrança para vincular.");

  const found = await prisma.clientInvoice.findMany({
    where: { id: { in: ids }, clientCompanyId, saleId: null, status: { not: "CANCELADO" } },
    select: { id: true, amountCents: true, description: true },
  });
  if (found.length !== ids.length) {
    throw new BillingLinkError(
      "Alguma cobrança escolhida não é deste cliente, está cancelada ou já pertence a outra venda. Atualize a lista e tente de novo.",
    );
  }

  await prisma.clientInvoice.updateMany({ where: { id: { in: ids } }, data: { saleId: sale.id } });

  // Uma linha por cobrança: é por aqui que o "desfazer" sabe que ela já
  // existia antes da venda e deve ser SOLTA, não apagada.
  for (const inv of found) {
    await logFinance({
      companyId: sale.companyId,
      clientCompanyId,
      entity: "COBRANCA",
      entityId: inv.id,
      action: LINKED,
      description: `Cobrança existente vinculada à venda "${sale.title}" na esteira`,
      meta: { saleId: sale.id, venda: sale.title, valorCents: inv.amountCents, cobranca: inv.description },
      session,
    });
  }

  return { totalCents: found.reduce((n, i) => n + i.amountCents, 0), count: found.length };
}

/**
 * Desfaz o "Faturado": cobrança que a venda CRIOU e ainda está em aberto é
 * apagada (como sempre foi); cobrança que foi só VINCULADA é solta e continua
 * na conta do cliente, paga ou não — ela existia antes e não é da esteira
 * apagar.
 */
export async function undoSaleBilling(saleId: string) {
  const atuais = await prisma.clientInvoice.findMany({ where: { saleId }, select: { id: true } });
  if (atuais.length === 0) return { removidas: 0, soltas: 0 };

  const marcas = await prisma.financeLog.findMany({
    where: { entity: "COBRANCA", action: LINKED, entityId: { in: atuais.map((i) => i.id) } },
    select: { entityId: true, meta: true },
  });
  const vinculadas = [
    ...new Set(
      marcas
        .filter((m) => (m.meta as { saleId?: string } | null)?.saleId === saleId)
        .map((m) => m.entityId as string),
    ),
  ];

  const soltas = vinculadas.length
    ? (await prisma.clientInvoice.updateMany({ where: { id: { in: vinculadas } }, data: { saleId: null } })).count
    : 0;
  const removidas = (await prisma.clientInvoice.deleteMany({ where: { saleId, status: "ABERTO" } })).count;
  return { removidas, soltas };
}
