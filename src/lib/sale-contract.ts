/**
 * Contrato da venda: envio, ACEITE e confirmação do faturamento.
 *
 * O "contrato" é a própria `Sale` da esteira pós-venda. Antes, "Assinado" e
 * "Faturado" eram cliques soltos — não guardavam onde estava o de acordo nem
 * quem disse que o faturamento estava certo. Aqui ficam as regras, usadas
 * igual pela tela (PATCH da venda), pela Central do Cliente e pelas
 * ferramentas do Claude:
 *
 *   1. Contrato só vai pra ASSINADO (aceito) com aceite registrado.
 *   2. Produção só é liberada com aceite + faturamento confirmado
 *      (ou com o checkpoint marcado como "não se aplica").
 */

import { prisma } from "./prisma";
import { logFinance } from "./finance-log";

export const ACCEPTANCE_TYPES = ["AUTENTIQUE", "EMAIL", "GOHUB", "OUTRO"] as const;
export const CONTRACT_DOC_TYPES = ["CONTRATO", "TERMO"] as const;
export const DOCUMENT_TYPES = ["PROPOSTA", "CONTRATO", "TERMO", "ADITIVO", "BRIEFING", "ENTREGA", "OUTRO"] as const;

export const ACCEPTANCE_LABEL: Record<string, string> = {
  AUTENTIQUE: "Autentique", EMAIL: "E-mail", GOHUB: "GoHub", OUTRO: "Outro",
};

/** Status de contrato como o usuário lê (o banco mantém os valores antigos). */
export const CONTRACT_STATUS_LABEL: Record<string, string> = {
  PENDENTE: "Rascunho", ENVIADO: "Enviado", ASSINADO: "Aceito", ENCERRADO: "Encerrado", DISPENSADO: "Não se aplica",
};

type Actor = { name?: string | null; session?: any };

function actorName(a: Actor): string | null {
  return a.name ?? a.session?.user?.name ?? a.session?.user?.email ?? null;
}

interface SaleGateFields {
  contractStatus: string;
  acceptedAt: Date | null;
  billingStatus: string;
  billingConfirmed: boolean;
}

/** O contrato está resolvido? (aceito COM aceite registrado, ou dispensado) */
export function contractAccepted(s: Pick<SaleGateFields, "contractStatus" | "acceptedAt">): boolean {
  return s.contractStatus === "DISPENSADO" || (s.contractStatus === "ASSINADO" && !!s.acceptedAt);
}

/** O faturamento foi confirmado? (ou não se aplica) */
export function billingOk(s: Pick<SaleGateFields, "billingStatus" | "billingConfirmed">): boolean {
  return s.billingConfirmed || s.billingStatus === "DISPENSADO";
}

/**
 * Por que a produção ainda NÃO pode ser liberada. null = pode.
 * Mensagem pronta pra tela e pro Claude.
 */
export function productionBlocker(s: SaleGateFields): string | null {
  const falta: string[] = [];
  if (!contractAccepted(s)) falta.push("o aceite do contrato registrado");
  if (!billingOk(s)) falta.push("o faturamento confirmado");
  if (falta.length === 0) return null;
  return `Produção só é liberada com ${falta.join(" e ")}.`;
}

export interface AcceptanceInput {
  acceptanceType: string;
  acceptanceUrl?: string | null;
  acceptedAt?: Date | null;
  acceptedByName?: string | null;
  acceptedByEmail?: string | null;
  emailId?: string | null;
  contractDocType?: string | null;
  contractDocumentId?: string | null;
}

/** Valida o aceite. Devolve mensagem de erro ou null. */
export function validateAcceptance(i: AcceptanceInput): string | null {
  if (!ACCEPTANCE_TYPES.includes(i.acceptanceType as any)) {
    return `Tipo de aceite inválido. Use: ${ACCEPTANCE_TYPES.join(", ")}.`;
  }
  if (!i.acceptanceUrl?.trim() && !i.emailId) {
    return "Informe o link do aceite (documento no Autentique, e-mail de \"de acordo\"…).";
  }
  if (!i.acceptedByName?.trim() && !i.acceptedByEmail?.trim()) {
    return "Informe quem aceitou (nome ou e-mail).";
  }
  if (i.contractDocType && !CONTRACT_DOC_TYPES.includes(i.contractDocType as any)) {
    return "Tipo de documento inválido. Use CONTRATO ou TERMO.";
  }
  if (i.acceptedAt && i.acceptedAt.getTime() > Date.now() + 24 * 3600 * 1000) {
    return "A data do aceite não pode estar no futuro.";
  }
  return null;
}

/** Link interno de um email do GoHub. */
export function emailLink(emailId: string): string {
  return `/emails?email=${emailId}`;
}

async function loadSale(saleId: string, agencyId: string | null) {
  const sale = await prisma.sale.findUnique({ where: { id: saleId } });
  if (!sale) throw new ContractError("Contrato (venda) não encontrado.", 404);
  if (agencyId && sale.companyId !== agencyId) throw new ContractError("Sem permissão para este contrato.", 403);
  return sale;
}

export class ContractError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/**
 * Registra o aceite: preenche os campos, marca o contrato como ASSINADO
 * (aceito) e, se veio de um email, marca o email como "aceite" e o liga ao
 * cliente.
 */
export async function recordAcceptance(saleId: string, input: AcceptanceInput, agencyId: string | null, actor: Actor) {
  const sale = await loadSale(saleId, agencyId);

  let email: { id: string; sentAt: Date; fromEmail: string; fromName: string | null; direction: string } | null = null;
  if (input.emailId) {
    email = await prisma.inboxEmail.findFirst({
      where: { id: input.emailId, companyId: sale.companyId },
      select: { id: true, sentAt: true, fromEmail: true, fromName: true, direction: true },
    });
    if (!email) throw new ContractError("E-mail não encontrado nesta empresa.");
    // O email é a prova: completa o que não veio.
    input.acceptanceUrl = input.acceptanceUrl?.trim() || emailLink(email.id);
    if (email.direction === "IN") {
      input.acceptedByEmail = input.acceptedByEmail?.trim() || email.fromEmail;
      input.acceptedByName = input.acceptedByName?.trim() || email.fromName;
    }
    input.acceptedAt = input.acceptedAt ?? email.sentAt;
  }

  const err = validateAcceptance(input);
  if (err) throw new ContractError(err);

  if (input.contractDocumentId) {
    const doc = await prisma.clientDocument.findFirst({
      where: { id: input.contractDocumentId, companyId: sale.companyId },
      select: { id: true },
    });
    if (!doc) throw new ContractError("Documento do contrato não encontrado.");
  }

  const acceptedAt = input.acceptedAt ?? new Date();
  const updated = await prisma.sale.update({
    where: { id: saleId },
    data: {
      acceptanceType: input.acceptanceType,
      acceptanceUrl: input.acceptanceUrl?.trim() || null,
      acceptedAt,
      acceptedByName: input.acceptedByName?.trim() || null,
      acceptedByEmail: input.acceptedByEmail?.trim().toLowerCase() || null,
      acceptanceEmailId: email?.id ?? sale.acceptanceEmailId,
      acceptanceRecordedBy: actorName(actor),
      contractStatus: "ASSINADO",
      contractAt: acceptedAt,
      contractSentAt: sale.contractSentAt ?? acceptedAt,
      ...(input.contractDocType ? { contractDocType: input.contractDocType } : {}),
      ...(input.contractDocumentId ? { contractDocumentId: input.contractDocumentId } : {}),
    },
  });

  if (email) {
    await prisma.inboxEmail.update({
      where: { id: email.id },
      data: {
        clientMark: "ACEITE",
        ...(sale.clientCompanyId ? { clientCompanyId: sale.clientCompanyId, clientLinkSource: "MANUAL" } : {}),
      },
    });
  }

  await logFinance({
    companyId: sale.companyId,
    clientCompanyId: sale.clientCompanyId,
    entity: "CONTRATO",
    entityId: sale.id,
    action: "ACEITE_REGISTRADO",
    description: `Aceite por ${ACCEPTANCE_LABEL[input.acceptanceType] ?? input.acceptanceType}${updated.acceptedByName || updated.acceptedByEmail ? ` — ${[updated.acceptedByName, updated.acceptedByEmail].filter(Boolean).join(" · ")}` : ""}`,
    meta: { venda: sale.title, link: updated.acceptanceUrl, acceptedAt: acceptedAt.toISOString() },
    session: actor.session ?? { user: { name: actorName(actor) } },
  });

  return updated;
}

/** Desfaz o aceite (registrado por engano). Contrato volta pra ENVIADO. */
export async function clearAcceptance(saleId: string, agencyId: string | null, actor: Actor) {
  const sale = await loadSale(saleId, agencyId);
  if (sale.productionStatus === "LIBERADO" || sale.productionStatus === "ENTREGUE") {
    throw new ContractError("A produção já foi liberada com este aceite — volte a produção antes de remover o aceite.");
  }
  const updated = await prisma.sale.update({
    where: { id: saleId },
    data: {
      acceptanceType: null, acceptanceUrl: null, acceptedAt: null, acceptedByName: null,
      acceptedByEmail: null, acceptanceEmailId: null, acceptanceRecordedBy: null,
      contractStatus: sale.contractSentAt ? "ENVIADO" : "PENDENTE",
    },
  });
  if (sale.acceptanceEmailId) {
    await prisma.inboxEmail.updateMany({
      where: { id: sale.acceptanceEmailId, clientMark: "ACEITE" },
      data: { clientMark: null },
    });
  }
  await logFinance({
    companyId: sale.companyId, clientCompanyId: sale.clientCompanyId, entity: "CONTRATO", entityId: sale.id,
    action: "ACEITE_REMOVIDO", description: "Aceite removido", meta: { venda: sale.title },
    session: actor.session ?? { user: { name: actorName(actor) } },
  });
  return updated;
}

/** Contrato/termo enviado ao cliente. */
export async function markContractSent(
  saleId: string,
  input: { sentAt?: Date | null; contractDocType?: string | null; contractDocumentId?: string | null },
  agencyId: string | null,
  actor: Actor,
) {
  const sale = await loadSale(saleId, agencyId);
  if (input.contractDocType && !CONTRACT_DOC_TYPES.includes(input.contractDocType as any)) {
    throw new ContractError("Tipo de documento inválido. Use CONTRATO ou TERMO.");
  }
  const sentAt = input.sentAt ?? new Date();
  const updated = await prisma.sale.update({
    where: { id: saleId },
    data: {
      contractSentAt: sentAt,
      // Já aceito continua aceito — enviar de novo um aditivo não "desaceita".
      ...(sale.contractStatus === "PENDENTE" ? { contractStatus: "ENVIADO", contractAt: sentAt } : {}),
      ...(input.contractDocType ? { contractDocType: input.contractDocType } : {}),
      ...(input.contractDocumentId ? { contractDocumentId: input.contractDocumentId } : {}),
    },
  });
  await logFinance({
    companyId: sale.companyId, clientCompanyId: sale.clientCompanyId, entity: "CONTRATO", entityId: sale.id,
    action: "CONTRATO_ENVIADO",
    description: `${input.contractDocType === "TERMO" ? "Termo" : "Contrato"} enviado ao cliente`,
    meta: { venda: sale.title, sentAt: sentAt.toISOString() },
    session: actor.session ?? { user: { name: actorName(actor) } },
  });
  return updated;
}

export interface BillingConfirmInput {
  confirmedBy?: string | null;
  confirmationUrl?: string | null;
  confirmedAt?: Date | null;
  emailId?: string | null;
  instructions?: string | null;
}

/** "Ok do financeiro": o combinado de cobrança está certo e pode faturar. */
export async function confirmBilling(saleId: string, input: BillingConfirmInput, agencyId: string | null, actor: Actor) {
  const sale = await loadSale(saleId, agencyId);

  let email: { id: string; sentAt: Date; fromName: string | null; fromEmail: string; direction: string } | null = null;
  if (input.emailId) {
    email = await prisma.inboxEmail.findFirst({
      where: { id: input.emailId, companyId: sale.companyId },
      select: { id: true, sentAt: true, fromName: true, fromEmail: true, direction: true },
    });
    if (!email) throw new ContractError("E-mail não encontrado nesta empresa.");
  }

  const confirmedBy =
    input.confirmedBy?.trim() ||
    (email?.direction === "IN" ? email.fromName || email.fromEmail : null) ||
    actorName(actor);
  if (!confirmedBy) throw new ContractError("Informe quem confirmou o faturamento.");
  const confirmedAt = input.confirmedAt ?? email?.sentAt ?? new Date();
  if (confirmedAt.getTime() > Date.now() + 24 * 3600 * 1000) {
    throw new ContractError("A data da confirmação não pode estar no futuro.");
  }

  const updated = await prisma.sale.update({
    where: { id: saleId },
    data: {
      billingConfirmed: true,
      billingConfirmedBy: confirmedBy,
      billingConfirmedAt: confirmedAt,
      billingConfirmationUrl: input.confirmationUrl?.trim() || (email ? emailLink(email.id) : sale.billingConfirmationUrl),
      billingConfirmationEmailId: email?.id ?? sale.billingConfirmationEmailId,
      ...(input.instructions !== undefined && input.instructions !== null
        ? { billingInstructions: input.instructions.trim() || null }
        : {}),
    },
  });

  if (email) {
    await prisma.inboxEmail.update({
      where: { id: email.id },
      data: {
        clientMark: "FATURAMENTO",
        ...(sale.clientCompanyId ? { clientCompanyId: sale.clientCompanyId, clientLinkSource: "MANUAL" } : {}),
      },
    });
  }

  await logFinance({
    companyId: sale.companyId, clientCompanyId: sale.clientCompanyId, entity: "CONTRATO", entityId: sale.id,
    action: "FATURAMENTO_CONFIRMADO", description: `Faturamento confirmado por ${confirmedBy}`,
    meta: { venda: sale.title, link: updated.billingConfirmationUrl, confirmedAt: confirmedAt.toISOString() },
    session: actor.session ?? { user: { name: actorName(actor) } },
  });
  return updated;
}

export async function unconfirmBilling(saleId: string, agencyId: string | null, actor: Actor) {
  const sale = await loadSale(saleId, agencyId);
  if (sale.productionStatus === "LIBERADO" || sale.productionStatus === "ENTREGUE") {
    throw new ContractError("A produção já foi liberada com esta confirmação — volte a produção antes de retirar.");
  }
  const updated = await prisma.sale.update({
    where: { id: saleId },
    data: {
      billingConfirmed: false, billingConfirmedBy: null, billingConfirmedAt: null,
      billingConfirmationUrl: null, billingConfirmationEmailId: null,
    },
  });
  if (sale.billingConfirmationEmailId) {
    await prisma.inboxEmail.updateMany({
      where: { id: sale.billingConfirmationEmailId, clientMark: "FATURAMENTO" },
      data: { clientMark: null },
    });
  }
  await logFinance({
    companyId: sale.companyId, clientCompanyId: sale.clientCompanyId, entity: "CONTRATO", entityId: sale.id,
    action: "FATURAMENTO_DESCONFIRMADO", description: "Confirmação de faturamento retirada", meta: { venda: sale.title },
    session: actor.session ?? { user: { name: actorName(actor) } },
  });
  return updated;
}

// ─── Serviços vendidos ──────────────────────────────────────────────────────

export interface SoldService {
  serviceId?: string | null;
  name: string;
  level?: string | null;
  recurring: boolean;
  startAt?: string | null; // YYYY-MM-DD
  durationMonths?: number | null;
  amountCents?: number | null;
}

/** Normaliza a lista que vem da tela/do Claude. Lança em entrada inválida. */
export function normalizeSoldServices(raw: unknown): SoldService[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new ContractError("Serviços vendidos devem ser uma lista.");
  return raw.slice(0, 30).map((r: any, i) => {
    const name = String(r?.name ?? "").trim();
    if (!name) throw new ContractError(`Serviço ${i + 1}: informe o nome.`);
    const start = r?.startAt ? String(r.startAt).slice(0, 10) : null;
    if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new ContractError(`Serviço ${i + 1}: data de início inválida.`);
    const dur = r?.durationMonths == null || r.durationMonths === "" ? null : Number(r.durationMonths);
    if (dur != null && (!Number.isFinite(dur) || dur < 0 || dur > 120)) throw new ContractError(`Serviço ${i + 1}: duração inválida.`);
    const amt = r?.amountCents == null || r.amountCents === "" ? null : Math.round(Number(r.amountCents));
    if (amt != null && (!Number.isFinite(amt) || amt < 0)) throw new ContractError(`Serviço ${i + 1}: valor inválido.`);
    return {
      serviceId: r?.serviceId ? String(r.serviceId) : null,
      name: name.slice(0, 120),
      level: r?.level ? String(r.level).trim().slice(0, 60) : null,
      recurring: !!r?.recurring,
      startAt: start,
      durationMonths: dur,
      amountCents: amt,
    };
  });
}

/** Uma linha legível por serviço (descrição do projeto, resumo do Claude). */
export function describeSoldServices(list: SoldService[]): string {
  return list
    .map((s) => {
      const partes = [
        s.name + (s.level ? ` (${s.level})` : ""),
        s.recurring ? "recorrente" : "pontual",
        s.startAt ? `início ${s.startAt.split("-").reverse().join("/")}` : null,
        s.durationMonths ? `${s.durationMonths} ${s.durationMonths === 1 ? "mês" : "meses"}` : null,
        s.amountCents ? (s.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : null,
      ].filter(Boolean);
      return `- ${partes.join(" · ")}`;
    })
    .join("\n");
}
