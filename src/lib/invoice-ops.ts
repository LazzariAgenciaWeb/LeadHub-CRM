import { prisma } from "@/lib/prisma";
import { logFinance } from "@/lib/finance-log";

/**
 * Operações de dinheiro na cobrança (ClientInvoice): baixa (total ou parcial),
 * estorno, cancelamento, reabertura e correção de valor/vencimento/ID externo.
 *
 * Fonte ÚNICA da regra: a tela (PATCH /api/empresas/[id]/financeiro/[invId])
 * e o assistente/MCP (assistant-tools/financeiro.ts) chamam estas funções. Se
 * mudar algo aqui, muda nos dois — de propósito.
 *
 * Princípios:
 *   - Nada some: estorno e cancelamento mantêm a linha e gravam quem, quando
 *     e por quê no FinanceLog (a cobrança cancelada guarda o motivo também).
 *   - Pagamento parcial NÃO quita: soma em paidCents e a cobrança segue ABERTO
 *     com saldo. Quita quando o recebido cobre o valor.
 *   - Escopo sempre pela agência (clientCompany.parentCompanyId) — quem chama
 *     passa o agencyId da sessão/token, nunca de input.
 *   - Toda transição de status é condicional ao estado lido (updateMany com o
 *     status/paidCents de antes): duas baixas simultâneas não somam duas vezes.
 */

export const PAYMENT_METHODS = ["PIX", "BOLETO", "TRANSFERENCIA", "CARTAO", "DINHEIRO", "OUTRO"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export class InvoiceOpError extends Error {
  constructor(
    public code: "NAO_ENCONTRADA" | "JA_PAGA" | "CANCELADA" | "SEM_PAGAMENTO" | "TEM_PAGAMENTO" | "ID_EXTERNO_EM_USO" | "INVALIDO" | "CONCORRENCIA",
    message: string,
  ) {
    super(message);
  }
}

type InvoiceRow = {
  id: string;
  clientCompanyId: string;
  description: string;
  referenceMonth: string | null;
  amountCents: number;
  dueDate: Date;
  status: string;
  paidAt: Date | null;
  paidCents: number | null;
  lastPaymentAt: Date | null;
  paymentMethod: string | null;
  paymentAccount: string | null;
  externalId: string | null;
  notes: string | null;
  canceledAt: Date | null;
  cancelReason: string | null;
  canceledBy: string | null;
};

/** Quem fez — vira o userName do FinanceLog (mesmo formato da sessão). */
export type Actor = { name: string | null };

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Total já recebido. PAGO sem paidCents = baixa antiga, paga integral. */
export function receivedCents(inv: { status: string; amountCents: number; paidCents: number | null }): number {
  if (inv.paidCents != null) return inv.paidCents;
  return inv.status === "PAGO" ? inv.amountCents : 0;
}

/** Quanto falta receber (0 se paga/cancelada). */
export function balanceCents(inv: { status: string; amountCents: number; paidCents: number | null }): number {
  if (inv.status !== "ABERTO") return 0;
  return Math.max(0, inv.amountCents - receivedCents(inv));
}

/**
 * Normaliza o ID externo: sem espaços nas pontas e o prefixo do sistema em
 * maiúsculas ("ultra:931" → "ULTRA:931"). Vazio → null.
 */
export function normalizeExternalId(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const i = s.indexOf(":");
  if (i <= 0) return s;
  return `${s.slice(0, i).trim().toUpperCase()}:${s.slice(i + 1).trim()}`;
}

/** Só dígitos do CNPJ/CPF. */
export function onlyDigits(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/**
 * Cobranças da carteira da agência. A segunda condição cobre a empresa sem
 * agência-mãe faturando a si mesma (agencyOf devolve o próprio id) — sem
 * abrir pra agência mexer na fatura que ELA recebe de outra.
 */
export function agencyInvoiceScope(agencyId: string) {
  return {
    OR: [
      { clientCompany: { parentCompanyId: agencyId } },
      { clientCompanyId: agencyId, clientCompany: { parentCompanyId: null } },
    ],
  };
}

async function load(agencyId: string, invoiceId: string): Promise<InvoiceRow & { clientName: string }> {
  const inv = await prisma.clientInvoice.findFirst({
    where: { id: invoiceId, ...agencyInvoiceScope(agencyId) },
    include: { clientCompany: { select: { name: true } } },
  });
  if (!inv) throw new InvoiceOpError("NAO_ENCONTRADA", "Cobrança não encontrada nesta carteira. Use listar_cobrancas pra achar o id certo.");
  return { ...inv, clientName: inv.clientCompany.name };
}

/** Acha a cobrança pelo id OU pelo ID externo (ULTRA:931), dentro da agência. */
export async function resolveInvoiceId(agencyId: string, ref: { invoiceId?: string | null; externalId?: string | null }): Promise<string> {
  if (ref.invoiceId) return ref.invoiceId;
  const ext = normalizeExternalId(ref.externalId);
  if (!ext) throw new InvoiceOpError("INVALIDO", "Informe cobrancaId ou externalId.");
  const found = await prisma.clientInvoice.findFirst({
    where: { externalId: ext, ...agencyInvoiceScope(agencyId) },
    select: { id: true },
  });
  if (!found) throw new InvoiceOpError("NAO_ENCONTRADA", `Nenhuma cobrança com ID externo ${ext}. Confira com listar_cobrancas (filtro externalId).`);
  return found.id;
}

/**
 * Garante que o ID externo não está em outra cobrança da MESMA agência.
 * Roda dentro de uma transação com trava advisory na chave (agência+ID), pra
 * duas gravações simultâneas do mesmo ID não passarem as duas.
 */
export async function withExternalIdLock<T>(
  agencyId: string,
  externalId: string | null,
  exceptInvoiceId: string | null,
  fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    if (externalId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-ext:${agencyId}:${externalId}`}))`;
      const clash = await tx.clientInvoice.findFirst({
        where: {
          externalId,
          ...agencyInvoiceScope(agencyId),
          ...(exceptInvoiceId ? { id: { not: exceptInvoiceId } } : {}),
        },
        select: { id: true, description: true, amountCents: true, clientCompany: { select: { name: true } } },
      });
      if (clash) {
        throw new InvoiceOpError(
          "ID_EXTERNO_EM_USO",
          `O ID externo ${externalId} já está na cobrança "${clash.description}" de ${clash.clientCompany.name} (${brl(clash.amountCents)}, id=${clash.id}). Cada título só pode estar em uma cobrança — confira qual é a certa.`,
        );
      }
    }
    return fn(tx);
  });
}

// ─── Baixa ──────────────────────────────────────────────────────────────────

export interface PaymentInput {
  agencyId: string;
  invoiceId: string;
  /** Valor recebido agora. Omitido = o saldo inteiro. */
  amountCents?: number | null;
  /** Data do recebimento. Omitida = agora. */
  paidAt?: Date | null;
  method?: string | null;
  account?: string | null;
  note?: string | null;
  actor: Actor;
  /** Onde a baixa foi feita (tela, assistente…) — vai pro meta do log. */
  source: string;
}

export interface PaymentResult {
  invoiceId: string;
  clientCompanyId: string;
  clientName: string;
  description: string;
  amountCents: number;
  receivedNowCents: number;
  totalReceivedCents: number;
  balanceCents: number;
  /** Recebido além do valor (juros/multa ou erro de digitação). */
  overpaidCents: number;
  settled: boolean;
  paidAt: Date;
}

export async function registerInvoicePayment(input: PaymentInput): Promise<PaymentResult> {
  const inv = await load(input.agencyId, input.invoiceId);
  if (inv.status === "PAGO") {
    throw new InvoiceOpError(
      "JA_PAGA",
      `A cobrança "${inv.description}" de ${inv.clientName} já está paga${inv.paidAt ? ` desde ${inv.paidAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""} (${brl(receivedCents(inv))}${inv.paymentMethod ? ` via ${inv.paymentMethod}` : ""}). Nada foi alterado. Se a baixa anterior estava errada, estorne antes (estornar_pagamento).`,
    );
  }
  if (inv.status === "CANCELADO") {
    throw new InvoiceOpError("CANCELADA", `A cobrança "${inv.description}" de ${inv.clientName} está cancelada${inv.cancelReason ? ` (${inv.cancelReason})` : ""}. Pra receber nela, reabra pela tela do cliente antes.`);
  }

  const before = receivedCents(inv);
  const balance = Math.max(0, inv.amountCents - before);
  // Sem valor = recebeu o saldo. Saldo zero (cobrança de R$ 0,00, cortesia)
  // só quita — é o que a tela sempre fez ao marcar como paga.
  const now = input.amountCents == null ? balance : Math.round(Number(input.amountCents));
  if (!Number.isInteger(now) || now < 0 || (input.amountCents != null && now === 0)) {
    throw new InvoiceOpError("INVALIDO", "Valor recebido inválido: informe em centavos, maior que zero.");
  }
  const method = input.method ? String(input.method).trim().toUpperCase() : null;
  if (method && !(PAYMENT_METHODS as readonly string[]).includes(method)) {
    throw new InvoiceOpError("INVALIDO", `Forma de pagamento inválida: use ${PAYMENT_METHODS.join(", ")}.`);
  }
  const paidAt = input.paidAt && !Number.isNaN(input.paidAt.getTime()) ? input.paidAt : new Date();
  const total = before + now;
  const settled = total >= inv.amountCents;

  const r = await prisma.clientInvoice.updateMany({
    // Condicional ao estado lido: se outra baixa entrou no meio, não soma duas vezes.
    where: { id: inv.id, status: "ABERTO", paidCents: inv.paidCents },
    data: {
      paidCents: total,
      lastPaymentAt: paidAt,
      paymentMethod: method ?? inv.paymentMethod,
      paymentAccount: input.account?.trim() || inv.paymentAccount,
      ...(settled ? { status: "PAGO", paidAt } : {}),
    },
  });
  if (r.count === 0) throw new InvoiceOpError("CONCORRENCIA", "A cobrança mudou enquanto a baixa era registrada (outra pessoa mexeu?). Consulte de novo antes de repetir.");

  const result: PaymentResult = {
    invoiceId: inv.id,
    clientCompanyId: inv.clientCompanyId,
    clientName: inv.clientName,
    description: inv.description,
    amountCents: inv.amountCents,
    receivedNowCents: now,
    totalReceivedCents: total,
    balanceCents: Math.max(0, inv.amountCents - total),
    overpaidCents: Math.max(0, total - inv.amountCents),
    settled,
    paidAt,
  };
  await logFinance({
    companyId: input.agencyId,
    clientCompanyId: inv.clientCompanyId,
    entity: "COBRANCA",
    entityId: inv.id,
    action: settled ? "PAGO" : "PAGAMENTO_PARCIAL",
    description: input.note ?? null,
    meta: {
      descricao: inv.description,
      competencia: inv.referenceMonth,
      valorCents: inv.amountCents,
      recebidoAgoraCents: now,
      recebidoTotalCents: total,
      saldoCents: result.balanceCents,
      ...(result.overpaidCents > 0 && { recebidoAMaisCents: result.overpaidCents }),
      dataPagamento: paidAt.toISOString(),
      forma: method,
      conta: input.account?.trim() || null,
      statusAntes: inv.status,
      statusDepois: settled ? "PAGO" : "ABERTO",
      origem: input.source,
    },
    session: { user: { name: input.actor.name } },
  });
  return result;
}

// ─── Estorno ────────────────────────────────────────────────────────────────

export interface ReverseResult {
  invoiceId: string;
  clientCompanyId: string;
  clientName: string;
  description: string;
  reversedCents: number;
  amountCents: number;
}

/** Desfaz TODA a baixa (total ou parcial): volta pra ABERTO sem recebimento. */
export async function reverseInvoicePayment(input: { agencyId: string; invoiceId: string; reason?: string | null; actor: Actor; source: string }): Promise<ReverseResult> {
  const inv = await load(input.agencyId, input.invoiceId);
  const received = receivedCents(inv);
  if (inv.status === "CANCELADO") throw new InvoiceOpError("CANCELADA", `A cobrança "${inv.description}" está cancelada — não há baixa pra estornar.`);
  if (inv.status !== "PAGO" && received === 0) {
    throw new InvoiceOpError("SEM_PAGAMENTO", `A cobrança "${inv.description}" de ${inv.clientName} não tem pagamento registrado. Nada a estornar.`);
  }
  const r = await prisma.clientInvoice.updateMany({
    where: { id: inv.id, status: inv.status, paidCents: inv.paidCents },
    data: { status: "ABERTO", paidAt: null, paidCents: null, lastPaymentAt: null, paymentMethod: null, paymentAccount: null },
  });
  if (r.count === 0) throw new InvoiceOpError("CONCORRENCIA", "A cobrança mudou enquanto o estorno era registrado. Consulte de novo antes de repetir.");
  await logFinance({
    companyId: input.agencyId,
    clientCompanyId: inv.clientCompanyId,
    entity: "COBRANCA",
    entityId: inv.id,
    action: "ESTORNADO",
    description: input.reason ?? null,
    meta: {
      descricao: inv.description,
      competencia: inv.referenceMonth,
      valorCents: inv.amountCents,
      estornadoCents: received,
      // O que a baixa dizia antes — é isso que o estorno apaga da linha.
      pagoEmAntes: inv.paidAt?.toISOString() ?? null,
      ultimoRecebimentoAntes: inv.lastPaymentAt?.toISOString() ?? null,
      formaAntes: inv.paymentMethod,
      contaAntes: inv.paymentAccount,
      statusAntes: inv.status,
      statusDepois: "ABERTO",
      origem: input.source,
    },
    session: { user: { name: input.actor.name } },
  });
  return { invoiceId: inv.id, clientCompanyId: inv.clientCompanyId, clientName: inv.clientName, description: inv.description, reversedCents: received, amountCents: inv.amountCents };
}

// ─── Cancelamento / reabertura ──────────────────────────────────────────────

export async function cancelInvoice(input: { agencyId: string; invoiceId: string; reason: string | null; actor: Actor; source: string }) {
  const inv = await load(input.agencyId, input.invoiceId);
  if (inv.status === "CANCELADO") {
    throw new InvoiceOpError("CANCELADA", `A cobrança "${inv.description}" de ${inv.clientName} já está cancelada${inv.cancelReason ? ` (motivo: ${inv.cancelReason})` : ""}. Nada foi alterado.`);
  }
  if (inv.status === "PAGO" || receivedCents(inv) > 0) {
    throw new InvoiceOpError("TEM_PAGAMENTO", `A cobrança "${inv.description}" de ${inv.clientName} tem ${brl(receivedCents(inv))} recebido. Estorne o pagamento antes (estornar_pagamento) e depois cancele.`);
  }
  const reason = input.reason?.trim() || null;
  const now = new Date();
  const r = await prisma.clientInvoice.updateMany({
    where: { id: inv.id, status: "ABERTO", paidCents: inv.paidCents },
    data: { status: "CANCELADO", paidAt: null, canceledAt: now, cancelReason: reason, canceledBy: input.actor.name },
  });
  if (r.count === 0) throw new InvoiceOpError("CONCORRENCIA", "A cobrança mudou enquanto o cancelamento era registrado. Consulte de novo antes de repetir.");
  await logFinance({
    companyId: input.agencyId,
    clientCompanyId: inv.clientCompanyId,
    entity: "COBRANCA",
    entityId: inv.id,
    action: "CANCELADO",
    description: reason,
    meta: { descricao: inv.description, competencia: inv.referenceMonth, valorCents: inv.amountCents, statusAntes: inv.status, statusDepois: "CANCELADO", origem: input.source },
    session: { user: { name: input.actor.name } },
  });
  return { invoiceId: inv.id, clientCompanyId: inv.clientCompanyId, clientName: inv.clientName, description: inv.description, amountCents: inv.amountCents, reason };
}

/** CANCELADO → ABERTO. O motivo do cancelamento sai da linha mas fica no log. */
export async function reopenCanceledInvoice(input: { agencyId: string; invoiceId: string; reason?: string | null; actor: Actor; source: string }) {
  const inv = await load(input.agencyId, input.invoiceId);
  if (inv.status !== "CANCELADO") throw new InvoiceOpError("INVALIDO", "Só dá pra reabrir cobrança cancelada.");
  const r = await prisma.clientInvoice.updateMany({
    where: { id: inv.id, status: "CANCELADO" },
    data: { status: "ABERTO", canceledAt: null, cancelReason: null, canceledBy: null },
  });
  if (r.count === 0) throw new InvoiceOpError("CONCORRENCIA", "A cobrança mudou no meio da operação. Consulte de novo.");
  await logFinance({
    companyId: input.agencyId,
    clientCompanyId: inv.clientCompanyId,
    entity: "COBRANCA",
    entityId: inv.id,
    action: "REABERTO",
    description: input.reason ?? null,
    meta: {
      descricao: inv.description, competencia: inv.referenceMonth, valorCents: inv.amountCents,
      statusAntes: "CANCELADO", statusDepois: "ABERTO",
      canceladoEmAntes: inv.canceledAt?.toISOString() ?? null, motivoCancelamentoAntes: inv.cancelReason, canceladoPorAntes: inv.canceledBy,
      origem: input.source,
    },
    session: { user: { name: input.actor.name } },
  });
}

// ─── Correção (valor, vencimento, ID externo…) ──────────────────────────────

export interface UpdateInput {
  agencyId: string;
  invoiceId: string;
  amountCents?: number;
  dueDate?: Date;
  /** null limpa; undefined não mexe. */
  externalId?: string | null;
  description?: string;
  notes?: string | null;
  reason?: string | null;
  actor: Actor;
  source: string;
}

export async function updateInvoice(input: UpdateInput) {
  const inv = await load(input.agencyId, input.invoiceId);
  const data: Record<string, unknown> = {};
  const changes: Record<string, { antes: unknown; depois: unknown }> = {};

  const moneyLocked = inv.status !== "ABERTO";
  if (input.amountCents !== undefined) {
    const c = Math.round(Number(input.amountCents));
    if (!Number.isInteger(c) || c < 0) throw new InvoiceOpError("INVALIDO", "Valor inválido: informe em centavos (R$ 1.500,00 = 150000).");
    if (c !== inv.amountCents) {
      if (moneyLocked) throw new InvoiceOpError(inv.status === "PAGO" ? "JA_PAGA" : "CANCELADA", `A cobrança está ${inv.status === "PAGO" ? "paga" : "cancelada"}: valor e vencimento não mudam assim. ${inv.status === "PAGO" ? "Estorne o pagamento antes" : "Reabra pela tela do cliente antes"} se precisar corrigir.`);
      data.amountCents = c;
      changes.valorCents = { antes: inv.amountCents, depois: c };
    }
  }
  if (input.dueDate !== undefined) {
    if (Number.isNaN(input.dueDate.getTime())) throw new InvoiceOpError("INVALIDO", "Vencimento inválido (use ISO 8601, ex.: 2026-12-10).");
    if (input.dueDate.getTime() !== inv.dueDate.getTime()) {
      if (moneyLocked) throw new InvoiceOpError(inv.status === "PAGO" ? "JA_PAGA" : "CANCELADA", `A cobrança está ${inv.status === "PAGO" ? "paga" : "cancelada"}: o vencimento não muda. ${inv.status === "PAGO" ? "Estorne o pagamento antes" : "Reabra pela tela do cliente antes"} se precisar corrigir.`);
      data.dueDate = input.dueDate;
      changes.vencimento = { antes: inv.dueDate.toISOString(), depois: input.dueDate.toISOString() };
    }
  }
  let ext: string | null | undefined;
  if (input.externalId !== undefined) {
    ext = normalizeExternalId(input.externalId);
    if (ext !== inv.externalId) {
      data.externalId = ext;
      changes.externalId = { antes: inv.externalId, depois: ext };
    }
  }
  if (input.description !== undefined && input.description.trim() && input.description.trim() !== inv.description) {
    data.description = input.description.trim();
    changes.descricao = { antes: inv.description, depois: data.description };
  }
  if (input.notes !== undefined) {
    const n = input.notes?.trim() || null;
    if (n !== inv.notes) {
      data.notes = n;
      changes.observacoes = { antes: inv.notes, depois: n };
    }
  }
  if (Object.keys(changes).length === 0) {
    return { invoiceId: inv.id, clientName: inv.clientName, description: inv.description, changed: [] as string[], settled: false, amountCents: inv.amountCents, receivedCents: receivedCents(inv), balanceCents: balanceCents(inv) };
  }

  // Valor reduzido até o que já entrou (ex.: diferença perdoada) → quita.
  const newAmount = (data.amountCents as number | undefined) ?? inv.amountCents;
  const rec = receivedCents(inv);
  const settles = inv.status === "ABERTO" && rec > 0 && rec >= newAmount;
  if (settles) {
    data.status = "PAGO";
    data.paidAt = inv.lastPaymentAt ?? new Date();
  }

  await withExternalIdLock(input.agencyId, data.externalId !== undefined ? (data.externalId as string | null) : null, inv.id, async (tx) => {
    const r = await tx.clientInvoice.updateMany({ where: { id: inv.id, status: inv.status, paidCents: inv.paidCents }, data });
    if (r.count === 0) throw new InvoiceOpError("CONCORRENCIA", "A cobrança mudou no meio da operação. Consulte de novo antes de repetir.");
  });

  await logFinance({
    companyId: input.agencyId,
    clientCompanyId: inv.clientCompanyId,
    entity: "COBRANCA",
    entityId: inv.id,
    action: "ALTERADO",
    description: input.reason ?? null,
    meta: { descricao: inv.description, competencia: inv.referenceMonth, valorCents: newAmount, campos: Object.keys(changes), alteracoes: changes, origem: input.source },
    session: { user: { name: input.actor.name } },
  });
  if (settles) {
    await logFinance({
      companyId: input.agencyId,
      clientCompanyId: inv.clientCompanyId,
      entity: "COBRANCA",
      entityId: inv.id,
      action: "PAGO",
      description: "Quitada pelo ajuste do valor ao que já tinha sido recebido.",
      meta: { descricao: inv.description, valorCents: newAmount, recebidoTotalCents: rec, statusAntes: "ABERTO", statusDepois: "PAGO", origem: input.source },
      session: { user: { name: input.actor.name } },
    });
  }
  return {
    invoiceId: inv.id,
    clientName: inv.clientName,
    description: (data.description as string | undefined) ?? inv.description,
    changed: Object.keys(changes),
    settled: settles,
    amountCents: newAmount,
    receivedCents: rec,
    balanceCents: settles ? 0 : inv.status === "ABERTO" ? Math.max(0, newAmount - rec) : 0,
  };
}
