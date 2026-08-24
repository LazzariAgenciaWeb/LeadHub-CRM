/**
 * Ciclo de vida da `Sale` — a venda fechada que sai do CRM e entra no
 * Financeiro.
 *
 * Vive aqui, e não no handler do lead, porque o gatilho vai passar a ter mais
 * de uma origem: hoje é o PATCH do lead; quando o webhook do ClickUp voltar a
 * derivar status (ver AGENTS/decisão "LeadHub assume, ClickUp espelha"), ele
 * chama a mesma função em vez de reimplementar a regra.
 */

import { prisma } from "./prisma";

export interface WonLeadInput {
  id: string;
  companyId: string;
  name: string | null;
  phone: string;
  value: number | null;
  clickupTaskId: string | null;
  wonAt: Date | null;
}

/** Título legível da venda quando o lead não tem nome cadastrado. */
function saleTitle(lead: WonLeadInput): string {
  return lead.name?.trim() || `Contato ${lead.phone}`;
}

/**
 * Cria (ou atualiza) a venda correspondente a um lead que acabou de ser ganho.
 *
 * Idempotente por `leadId`: fechar → reabrir → fechar de novo mexe na MESMA
 * linha, preservando o que a esteira já registrou (contrato assinado, cliente
 * vinculado). Só valor, título e data de fechamento são reescritos — o resto é
 * trabalho humano e não pode ser apagado por um arrastar de card.
 */
export async function upsertSaleFromWonLead(
  lead: WonLeadInput,
  seller: { id?: string | null; name?: string | null },
): Promise<void> {
  const closedAt = lead.wonAt ?? new Date();
  const valueCents = Math.round((lead.value ?? 0) * 100);

  await prisma.sale.upsert({
    where: { leadId: lead.id },
    create: {
      companyId: lead.companyId,
      leadId: lead.id,
      title: saleTitle(lead),
      valueCents,
      closedAt,
      sellerId: seller.id ?? null,
      sellerName: seller.name ?? null,
      clickupTaskId: lead.clickupTaskId,
    },
    update: {
      title: saleTitle(lead),
      valueCents,
      closedAt,
      ...(lead.clickupTaskId ? { clickupTaskId: lead.clickupTaskId } : {}),
    },
  });
}

/**
 * Lead deixou de ser ganho (reabertura). Remove a venda APENAS se ninguém
 * encostou nela — sem cliente vinculado e com os três checkpoints pendentes.
 *
 * O caso comum é card arrastado por engano: some sem deixar lixo. Se a venda
 * já tem contrato assinado ou cliente vinculado, ela permanece: apagar
 * trabalho humano por causa de um drag-and-drop seria pior que deixar uma
 * linha inconsistente, que pelo menos é visível e corrigível.
 */
export async function removeSaleIfUntouched(leadId: string): Promise<void> {
  await prisma.sale.deleteMany({
    where: {
      leadId,
      clientCompanyId: null,
      contractStatus: "PENDENTE",
      billingStatus: "PENDENTE",
      productionStatus: "PENDENTE",
    },
  });
}
