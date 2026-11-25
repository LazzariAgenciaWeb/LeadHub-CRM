import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { logFinance } from "@/lib/finance-log";
import {
  InvoiceOpError, PAYMENT_METHODS, balanceCents, cancelInvoice, normalizeExternalId, receivedCents,
  registerInvoicePayment, resolveInvoiceId, reverseInvoicePayment, updateInvoice, withExternalIdLock,
  agencyInvoiceScope, type PaymentResult,
} from "@/lib/invoice-ops";
import { clientIdsByDocument, formatDocument } from "@/lib/client-document";
import { type ToolDef, type ToolContext, type ToolResult, ok, fail, appUrl, parseDate, fmtDate, brl } from "./types";

/**
 * Financeiro. Tudo que mexe em dinheiro tem `confirm: true` — no chat/WhatsApp
 * vira ação pendente até o usuário confirmar; no MCP executa na hora (o
 * cliente MCP confirma do lado dele, ver instruções em mcp-server.ts).
 *
 * A regra de baixa/estorno/cancelamento mora em src/lib/invoice-ops.ts, a
 * MESMA que a tela usa — aqui só se traduz entrada e resposta.
 */

const TZ = process.env.SYSTEM_TIMEZONE || "America/Sao_Paulo";
const fmtD = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }) : "sem data";

const actorOf = (ctx: ToolContext) => ({ name: ctx.userName });
const sourceOf = (ctx: ToolContext) => `assistente (${ctx.channel})`;

/** Erro de regra vira mensagem acionável; qualquer outro sobe. */
async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof InvoiceOpError) return fail(e.message);
    throw e;
  }
}

const REF_PROPS = {
  cobrancaId: { type: "string", description: "id da cobrança (de listar_cobrancas)" },
  externalId: { type: "string", description: "Ou o ID externo do título, ex.: ULTRA:931 / BLING:123456" },
} as const;

const refOf = (i: { cobrancaId?: string; externalId?: string }) => i.cobrancaId || i.externalId || "?";

// ─── Lançar ─────────────────────────────────────────────────────────────────

export const lancarCobranca: ToolDef<{ clientCompanyId: string; description: string; amountCents: number; dueDate: string; referenceMonth?: string; notes?: string; externalId?: string }> = {
  name: "lancar_cobranca",
  description:
    "Lança uma cobrança (fatura) manual para um cliente. amountCents em CENTAVOS (R$ 1.500,00 = 150000). dueDate ISO 8601. referenceMonth opcional 'YYYY-MM'. externalId opcional: o número do título no financeiro no formato SISTEMA:número (ULTRA:931, BLING:123) — único por empresa. Executa na hora: confirme com o usuário antes.",
  input_schema: {
    type: "object",
    properties: {
      clientCompanyId: { type: "string" },
      description: { type: "string" },
      amountCents: { type: "integer", minimum: 0 },
      dueDate: { type: "string" },
      referenceMonth: { type: "string" },
      notes: { type: "string" },
      externalId: { type: "string", description: "SISTEMA:número, ex.: ULTRA:931" },
    },
    required: ["clientCompanyId", "description", "amountCents", "dueDate"],
  },
  mutating: true,
  confirm: true,
  summarize: (i) => `Lançar cobrança de ${brl(i.amountCents)} — "${i.description}" — vencimento ${fmtDate(parseDate(i.dueDate))}${i.externalId ? ` · ${i.externalId}` : ""}`,
  run: (input, ctx) => guard(async () => {
    const client = await prisma.company.findFirst({ where: { id: input.clientCompanyId, parentCompanyId: ctx.companyId }, select: { id: true, name: true } });
    if (!client) return fail("Cliente não encontrado na carteira. Use buscar_cliente (por nome ou CNPJ/CPF) pra pegar o clientCompanyId.");
    // Só a data ("2026-12-10") vira meio-dia de Brasília — senão cai no dia anterior.
    const dv = String(input.dueDate ?? "").trim();
    const due = /^\d{4}-\d{2}-\d{2}$/.test(dv) ? new Date(`${dv}T12:00:00-03:00`) : parseDate(dv);
    if (!due) return fail("dueDate inválido (use ISO 8601, ex.: 2026-12-10).");
    if (!Number.isInteger(input.amountCents) || input.amountCents < 0) return fail("amountCents inválido (centavos, inteiro).");
    const externalId = normalizeExternalId(input.externalId);

    const inv = await withExternalIdLock(ctx.companyId, externalId, null, (tx) => tx.clientInvoice.create({
      data: {
        clientCompanyId: client.id,
        description: input.description.trim(),
        amountCents: input.amountCents,
        dueDate: due,
        referenceMonth: input.referenceMonth?.trim() || null,
        notes: input.notes?.trim() || null,
        externalId,
        status: "ABERTO",
        provider: "manual",
      },
      select: { id: true },
    }));
    await logFinance({
      companyId: ctx.companyId, clientCompanyId: client.id, entity: "COBRANCA", entityId: inv.id, action: "CRIADO",
      description: `${input.description.trim()} · ${brl(input.amountCents)} (assistente)`,
      meta: { valorCents: input.amountCents, externalId, origem: sourceOf(ctx) },
      session: { user: { name: ctx.userName } },
    });
    return ok(`💰 Cobrança lançada para ${client.name}: ${brl(input.amountCents)} · "${input.description.trim()}" · vence ${fmtDate(due)}${externalId ? ` · ${externalId}` : ""}`, {
      data: { id: inv.id }, link: appUrl(`/empresas/${client.id}?aba=financeiro`),
    });
  }),
};

// ─── Listar ─────────────────────────────────────────────────────────────────

type ListInput = {
  status?: "ABERTO" | "ATRASADO" | "PARCIAL" | "PAGO" | "CANCELADO";
  clientCompanyId?: string;
  cliente?: string;
  documento?: string;
  mes?: string;
  vencimentoDe?: string;
  vencimentoAte?: string;
  pagamentoDe?: string;
  pagamentoAte?: string;
  externalId?: string;
  pagina?: number;
  porPagina?: number;
};

/** "2026-11-30" vira o FIM daquele dia; com hora, respeita a hora. */
function endOf(v: string | undefined): Date | null {
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return new Date(`${v.trim()}T23:59:59.999-03:00`);
  return parseDate(v);
}

function startOf(v: string | undefined): Date | null {
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return new Date(`${v.trim()}T00:00:00-03:00`);
  return parseDate(v);
}

export const listarCobrancas: ToolDef<ListInput> = {
  name: "listar_cobrancas",
  description:
    "Lista COMPLETA e paginada das cobranças da carteira, com filtros combináveis: status (ABERTO, ATRASADO = aberta e vencida, PARCIAL = aberta com pagamento parcial, PAGO, CANCELADO; omitido = todas), cliente (clientCompanyId, trecho do nome em `cliente` ou CNPJ/CPF em `documento`), competência (mes 'YYYY-MM'), vencimento (vencimentoDe/vencimentoAte), data de pagamento (pagamentoDe/pagamentoAte — só as quitadas) e ID externo (ULTRA:931). Datas 'YYYY-MM-DD'. Devolve id, cliente, CNPJ/CPF, valor, recebido, saldo, vencimento, status, forma/conta do pagamento, motivo do cancelamento e o ID externo, mais os totais de TODO o filtro (não só da página). porPagina padrão 50, máx. 200; use pagina pra seguir.",
  input_schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["ABERTO", "ATRASADO", "PARCIAL", "PAGO", "CANCELADO"] },
      clientCompanyId: { type: "string" },
      cliente: { type: "string", description: "Trecho do nome (razão social ou fantasia)" },
      documento: { type: "string", description: "CNPJ/CPF, com ou sem máscara" },
      mes: { type: "string", description: "Competência 'YYYY-MM'" },
      vencimentoDe: { type: "string" },
      vencimentoAte: { type: "string" },
      pagamentoDe: { type: "string" },
      pagamentoAte: { type: "string" },
      externalId: { type: "string" },
      pagina: { type: "integer", minimum: 1 },
      porPagina: { type: "integer", minimum: 1, maximum: 200 },
    },
  },
  run: async (input, ctx) => {
    const and: Prisma.ClientInvoiceWhereInput[] = [agencyInvoiceScope(ctx.companyId)];
    const now = ctx.now;
    switch (input.status) {
      case "ABERTO": and.push({ status: "ABERTO" }); break;
      case "ATRASADO": and.push({ status: "ABERTO", dueDate: { lt: now } }); break;
      case "PARCIAL": and.push({ status: "ABERTO", paidCents: { gt: 0 } }); break;
      case "PAGO": and.push({ status: "PAGO" }); break;
      case "CANCELADO": and.push({ status: "CANCELADO" }); break;
      case undefined: break;
      default: return fail("status inválido: use ABERTO, ATRASADO, PARCIAL, PAGO ou CANCELADO (ou omita pra todas).");
    }
    if (input.clientCompanyId) and.push({ clientCompanyId: input.clientCompanyId });
    if (input.cliente?.trim()) {
      const q = input.cliente.trim();
      and.push({ clientCompany: { OR: [{ name: { contains: q, mode: "insensitive" } }, { tradeName: { contains: q, mode: "insensitive" } }] } });
    }
    if (input.documento?.trim()) {
      const ids = await clientIdsByDocument(ctx.companyId, input.documento);
      if (ids.length === 0) return ok(`Nenhum cliente com o documento ${formatDocument(input.documento)} na carteira. Confira com buscar_cliente — o CNPJ/CPF pode não estar no cadastro.`, { data: { total: 0, itens: [] } });
      and.push({ clientCompanyId: { in: ids } });
    }
    if (input.mes?.trim()) {
      if (!/^\d{4}-\d{2}$/.test(input.mes.trim())) return fail("mes deve ser 'YYYY-MM'.");
      and.push({ referenceMonth: input.mes.trim() });
    }
    const vDe = startOf(input.vencimentoDe), vAte = endOf(input.vencimentoAte);
    if (input.vencimentoDe && !vDe) return fail("vencimentoDe inválido (use YYYY-MM-DD).");
    if (input.vencimentoAte && !vAte) return fail("vencimentoAte inválido (use YYYY-MM-DD).");
    if (vDe || vAte) and.push({ dueDate: { ...(vDe && { gte: vDe }), ...(vAte && { lte: vAte }) } });
    const pDe = startOf(input.pagamentoDe), pAte = endOf(input.pagamentoAte);
    if (input.pagamentoDe && !pDe) return fail("pagamentoDe inválido (use YYYY-MM-DD).");
    if (input.pagamentoAte && !pAte) return fail("pagamentoAte inválido (use YYYY-MM-DD).");
    if (pDe || pAte) and.push({ paidAt: { ...(pDe && { gte: pDe }), ...(pAte && { lte: pAte }) } });
    const ext = normalizeExternalId(input.externalId);
    if (ext) and.push({ externalId: ext });

    const where = { AND: and };
    const porPagina = Math.min(200, Math.max(1, Math.floor(input.porPagina ?? 50)));
    const pagina = Math.max(1, Math.floor(input.pagina ?? 1));

    const [total, rows, somaValor, somaRecebidoExplicito, somaPagoLegado, somaAberto] = await Promise.all([
      prisma.clientInvoice.count({ where }),
      prisma.clientInvoice.findMany({
        where,
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        skip: (pagina - 1) * porPagina,
        take: porPagina,
        select: {
          id: true, description: true, referenceMonth: true, amountCents: true, dueDate: true, status: true,
          paidAt: true, paidCents: true, lastPaymentAt: true, paymentMethod: true, paymentAccount: true,
          externalId: true, cancelReason: true, canceledAt: true, canceledBy: true, provider: true,
          clientCompany: { select: { id: true, name: true, tradeName: true, document: true } },
        },
      }),
      prisma.clientInvoice.aggregate({ where: { AND: [...and, { status: { not: "CANCELADO" } }] }, _sum: { amountCents: true } }),
      prisma.clientInvoice.aggregate({ where: { AND: [...and, { paidCents: { not: null } }] }, _sum: { paidCents: true } }),
      prisma.clientInvoice.aggregate({ where: { AND: [...and, { status: "PAGO", paidCents: null }] }, _sum: { amountCents: true } }),
      prisma.clientInvoice.aggregate({ where: { AND: [...and, { status: "ABERTO" }] }, _sum: { amountCents: true, paidCents: true } }),
    ]);

    const recebido = (somaRecebidoExplicito._sum.paidCents ?? 0) + (somaPagoLegado._sum.amountCents ?? 0);
    const emAberto = Math.max(0, (somaAberto._sum.amountCents ?? 0) - (somaAberto._sum.paidCents ?? 0));
    const paginas = Math.max(1, Math.ceil(total / porPagina));

    const itens = rows.map((r) => {
      const rec = receivedCents(r);
      const saldo = balanceCents(r);
      const atrasada = r.status === "ABERTO" && r.dueDate < now;
      const situacao =
        r.status === "PAGO" ? "PAGO"
        : r.status === "CANCELADO" ? "CANCELADO"
        : rec > 0 ? (atrasada ? "PARCIAL_ATRASADO" : "PARCIAL")
        : atrasada ? "ATRASADO" : "ABERTO";
      return {
        id: r.id,
        cliente: r.clientCompany.tradeName || r.clientCompany.name,
        clientCompanyId: r.clientCompany.id,
        documento: formatDocument(r.clientCompany.document),
        descricao: r.description,
        competencia: r.referenceMonth,
        valorCents: r.amountCents,
        recebidoCents: rec,
        saldoCents: saldo,
        vencimento: r.dueDate.toISOString(),
        situacao,
        pagoEm: r.paidAt?.toISOString() ?? null,
        ultimoRecebimento: r.lastPaymentAt?.toISOString() ?? null,
        forma: r.paymentMethod,
        conta: r.paymentAccount,
        externalId: r.externalId,
        motivoCancelamento: r.cancelReason,
        canceladaEm: r.canceledAt?.toISOString() ?? null,
        canceladaPor: r.canceledBy,
        origem: r.provider,
      };
    });

    const linha = (i: (typeof itens)[number]) => {
      const st =
        i.situacao === "PAGO" ? `PAGA ${fmtD(i.pagoEm ? new Date(i.pagoEm) : null)}${i.recebidoCents !== i.valorCents ? ` (recebido ${brl(i.recebidoCents)})` : ""}${i.forma ? ` · ${i.forma}` : ""}${i.conta ? ` · ${i.conta}` : ""}`
        : i.situacao === "CANCELADO" ? `CANCELADA${i.motivoCancelamento ? `: ${i.motivoCancelamento}` : ""}`
        : i.situacao.startsWith("PARCIAL") ? `PARCIAL${i.situacao === "PARCIAL_ATRASADO" ? " e ATRASADA" : ""}: recebido ${brl(i.recebidoCents)}, falta ${brl(i.saldoCents)}`
        : i.situacao;
      return `- ${i.cliente}${i.documento ? ` (${i.documento})` : ""} · ${i.descricao} · ${brl(i.valorCents)} · venc. ${fmtD(new Date(i.vencimento))} · ${st}${i.externalId ? ` · ${i.externalId}` : ""}${i.competencia ? ` · comp. ${i.competencia}` : ""} · id=${i.id}`;
    };

    const head = `${total} cobrança(s) · página ${pagina}/${paginas} · valor ${brl(somaValor._sum.amountCents ?? 0)} (sem canceladas) · recebido ${brl(recebido)} · em aberto ${brl(emAberto)}`;
    const tail = pagina < paginas ? `\n… mais ${total - pagina * porPagina}: chame de novo com pagina=${pagina + 1}.` : "";
    return ok(total === 0 ? "Nenhuma cobrança com esses filtros." : `${head}\n${itens.map(linha).join("\n")}${tail}`, {
      data: { total, pagina, porPagina, paginas, totais: { valorCents: somaValor._sum.amountCents ?? 0, recebidoCents: recebido, emAbertoCents: emAberto }, itens },
    });
  },
};

// ─── Baixa ──────────────────────────────────────────────────────────────────

type PayInput = {
  cobrancaId?: string;
  externalId?: string;
  valorRecebidoCents?: number;
  dataPagamento?: string;
  forma?: string;
  conta?: string;
  observacao?: string;
};

function paymentLine(r: PaymentResult): string {
  const quem = `${r.clientName} — "${r.description}"`;
  if (r.settled) {
    const extra = r.overpaidCents > 0 ? ` ⚠️ Recebido ${brl(r.overpaidCents)} A MAIS que o valor (${brl(r.amountCents)}) — juros/multa ou erro de digitação? Se foi erro, estorne e lance de novo.` : "";
    return `✅ ${quem}: recebido ${brl(r.receivedNowCents)} em ${fmtD(r.paidAt)} — QUITADA (total recebido ${brl(r.totalReceivedCents)} de ${brl(r.amountCents)}).${extra}`;
  }
  return `🟡 ${quem}: pagamento PARCIAL de ${brl(r.receivedNowCents)} em ${fmtD(r.paidAt)}. Recebido até agora ${brl(r.totalReceivedCents)} de ${brl(r.amountCents)} — FICOU ${brl(r.balanceCents)} EM ABERTO. A cobrança continua aberta; se a diferença foi perdoada, ajuste o valor com atualizar_cobranca (aí ela quita).`;
}

async function payOne(input: PayInput, ctx: ToolContext): Promise<PaymentResult> {
  const invoiceId = await resolveInvoiceId(ctx.companyId, { invoiceId: input.cobrancaId, externalId: input.externalId });
  let paidAt: Date | null = null;
  if (input.dataPagamento) {
    const v = input.dataPagamento.trim();
    // "YYYY-MM-DD" vira meio-dia de Brasília: a data não escorrega de dia em fuso nenhum.
    paidAt = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00-03:00`) : parseDate(v);
    if (!paidAt || Number.isNaN(paidAt.getTime())) throw new InvoiceOpError("INVALIDO", "dataPagamento inválida (use YYYY-MM-DD).");
    if (paidAt.getTime() > ctx.now.getTime() + 36e5 * 24) throw new InvoiceOpError("INVALIDO", "dataPagamento no futuro — baixa é do que já entrou. Confira a data.");
  }
  return registerInvoicePayment({
    agencyId: ctx.companyId,
    invoiceId,
    amountCents: input.valorRecebidoCents ?? null,
    paidAt,
    method: input.forma ?? null,
    account: input.conta ?? null,
    note: input.observacao ?? null,
    actor: actorOf(ctx),
    source: sourceOf(ctx),
  });
}

const PAY_PROPS = {
  ...REF_PROPS,
  valorRecebidoCents: { type: "integer", minimum: 1, description: "Valor que ENTROU, em centavos. Omitido = o saldo inteiro em aberto." },
  dataPagamento: { type: "string", description: "Data do recebimento 'YYYY-MM-DD'. Omitida = hoje." },
  forma: { type: "string", enum: [...PAYMENT_METHODS] },
  conta: { type: "string", description: "Conta que recebeu (ex.: Inter, Sicoob)" },
} as const;

export const registrarPagamento: ToolDef<PayInput> = {
  name: "registrar_pagamento",
  description:
    "Dá baixa numa cobrança: registra o que foi recebido (data, valor, forma — PIX, BOLETO, TRANSFERENCIA, CARTAO, DINHEIRO, OUTRO — e conta). Identifique por cobrancaId ou pelo ID externo (ULTRA:931). Sem valorRecebidoCents, baixa o saldo inteiro. Aceita pagamento PARCIAL: se o valor não cobre o saldo, a cobrança continua ABERTA e a resposta diz quanto ficou em aberto. Não duplica: cobrança já paga é recusada (estorne antes se a baixa anterior estava errada). Mesma regra da tela. EXECUTA NA HORA — confirme cliente, valor e data com o usuário antes.",
  input_schema: { type: "object", properties: { ...PAY_PROPS, observacao: { type: "string" } } },
  mutating: true,
  confirm: true,
  summarize: (i) => `Registrar pagamento ${i.valorRecebidoCents ? `de ${brl(i.valorRecebidoCents)}` : "do saldo inteiro"} na cobrança ${refOf(i)}${i.dataPagamento ? ` em ${i.dataPagamento}` : ""}${i.forma ? ` via ${i.forma}` : ""}${i.conta ? ` (${i.conta})` : ""}`,
  run: (input, ctx) => guard(async () => {
    const r = await payOne(input, ctx);
    return ok(paymentLine(r), { data: r, link: appUrl(`/empresas/${r.clientCompanyId}?aba=financeiro`) });
  }),
};

type BatchInput = { pagamentos: PayInput[]; dataPagamento?: string; forma?: string; conta?: string };

export const registrarPagamentosLote: ToolDef<BatchInput> = {
  name: "registrar_pagamentos_lote",
  description:
    "Baixa VÁRIAS cobranças de uma vez (até 50) — ex.: conferência do extrato. Cada item tem cobrancaId ou externalId e, opcionalmente, valorRecebidoCents/dataPagamento/forma/conta; dataPagamento, forma e conta no nível de cima valem pra todos os itens que não informarem. Cada item segue a mesma regra de registrar_pagamento (parcial fica aberta; já paga é recusada, sem duplicar) e é processado independente: a resposta lista o que baixou, o que ficou parcial e o que falhou com o motivo. EXECUTA NA HORA — confirme a lista com o usuário antes.",
  input_schema: {
    type: "object",
    properties: {
      pagamentos: { type: "array", minItems: 1, maxItems: 50, items: { type: "object", properties: { ...PAY_PROPS } } },
      dataPagamento: PAY_PROPS.dataPagamento,
      forma: PAY_PROPS.forma,
      conta: PAY_PROPS.conta,
    },
    required: ["pagamentos"],
  },
  mutating: true,
  confirm: true,
  summarize: (i) => `Registrar ${i.pagamentos?.length ?? 0} pagamento(s) em lote${i.dataPagamento ? ` em ${i.dataPagamento}` : ""}${i.forma ? ` via ${i.forma}` : ""}: ${(i.pagamentos ?? []).map((p) => `${refOf(p)}${p.valorRecebidoCents ? ` ${brl(p.valorRecebidoCents)}` : ""}`).join(", ")}`,
  run: async (input, ctx) => {
    const itens = Array.isArray(input.pagamentos) ? input.pagamentos : [];
    if (itens.length === 0) return fail("Mande ao menos um item em pagamentos.");
    if (itens.length > 50) return fail("Máximo de 50 por lote — divida em mais chamadas.");
    // Mesma cobrança duas vezes no lote = quase sempre erro de montagem da lista.
    const seen = new Set<string>();
    const out: { ref: string; ok: boolean; text: string; result?: PaymentResult }[] = [];
    for (const raw of itens) {
      const p: PayInput = { dataPagamento: input.dataPagamento, forma: input.forma, conta: input.conta, ...stripUndef(raw) };
      const ref = refOf(p);
      try {
        const invoiceId = await resolveInvoiceId(ctx.companyId, { invoiceId: p.cobrancaId, externalId: p.externalId });
        if (seen.has(invoiceId)) throw new InvoiceOpError("INVALIDO", "a mesma cobrança aparece mais de uma vez no lote — só a primeira foi considerada. Confira a lista.");
        seen.add(invoiceId);
        const r = await payOne({ ...p, cobrancaId: invoiceId }, ctx);
        out.push({ ref, ok: true, text: paymentLine(r), result: r });
      } catch (e) {
        if (!(e instanceof InvoiceOpError)) throw e;
        out.push({ ref, ok: false, text: `❌ ${ref}: ${e.message}` });
      }
    }
    const okCount = out.filter((o) => o.ok).length;
    const quitadas = out.filter((o) => o.result?.settled).length;
    const recebido = out.reduce((a, o) => a + (o.result?.receivedNowCents ?? 0), 0);
    const head = `Lote: ${okCount}/${out.length} registradas (${quitadas} quitadas, ${okCount - quitadas} parciais) · ${brl(recebido)} recebido · ${out.length - okCount} com erro.`;
    const msg = `${head}\n${out.map((o) => o.text).join("\n")}`;
    if (okCount === 0) return fail(msg);
    return ok(msg, { data: out.map((o) => ({ ref: o.ref, ok: o.ok, mensagem: o.text, resultado: o.result ?? null })) });
  },
};

function stripUndef<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Partial<T>;
}

// ─── Estorno / cancelamento / correção ──────────────────────────────────────

export const estornarPagamento: ToolDef<{ cobrancaId?: string; externalId?: string; motivo: string }> = {
  name: "estornar_pagamento",
  description:
    "Desfaz a baixa de uma cobrança (paga ou com pagamento parcial): ela volta pra ABERTA sem nenhum recebimento. Use pra corrigir baixa errada. motivo é obrigatório e fica na trilha do financeiro junto com quem fez, quando e o que a baixa dizia (valor, data, forma, conta) — nada some. Depois, se for o caso, registre o pagamento certo com registrar_pagamento. EXECUTA NA HORA — confirme com o usuário antes.",
  input_schema: {
    type: "object",
    properties: { ...REF_PROPS, motivo: { type: "string", description: "Por que a baixa está sendo desfeita" } },
    required: ["motivo"],
  },
  mutating: true,
  confirm: true,
  summarize: (i) => `Estornar o pagamento da cobrança ${refOf(i)} — motivo: ${i.motivo}`,
  run: (input, ctx) => guard(async () => {
    if (!input.motivo?.trim()) return fail("Informe o motivo do estorno — ele fica registrado na trilha do financeiro.");
    const invoiceId = await resolveInvoiceId(ctx.companyId, { invoiceId: input.cobrancaId, externalId: input.externalId });
    const r = await reverseInvoicePayment({ agencyId: ctx.companyId, invoiceId, reason: input.motivo.trim(), actor: actorOf(ctx), source: sourceOf(ctx) });
    return ok(`↩️ Baixa estornada: ${r.clientName} — "${r.description}". ${brl(r.reversedCents)} deixou de constar como recebido; a cobrança voltou pra ABERTA (${brl(r.amountCents)}). Motivo registrado: ${input.motivo.trim()}.`, {
      data: r, link: appUrl(`/empresas/${r.clientCompanyId}?aba=financeiro`),
    });
  }),
};

export const cancelarCobranca: ToolDef<{ cobrancaId?: string; externalId?: string; motivo: string }> = {
  name: "cancelar_cobranca",
  description:
    "Cancela uma cobrança que NÃO é devida (lançada por engano, serviço não prestado, acordo). A linha não é apagada: fica CANCELADA com o motivo, quem cancelou e quando, e some dos totais em aberto. motivo é obrigatório. Cobrança com pagamento registrado não cancela — estorne antes (estornar_pagamento). EXECUTA NA HORA — confirme com o usuário antes.",
  input_schema: {
    type: "object",
    properties: { ...REF_PROPS, motivo: { type: "string", description: "Por que a cobrança não é devida" } },
    required: ["motivo"],
  },
  mutating: true,
  confirm: true,
  summarize: (i) => `Cancelar a cobrança ${refOf(i)} — motivo: ${i.motivo}`,
  run: (input, ctx) => guard(async () => {
    if (!input.motivo?.trim()) return fail("Informe o motivo do cancelamento — ele fica registrado na cobrança e na trilha do financeiro.");
    const invoiceId = await resolveInvoiceId(ctx.companyId, { invoiceId: input.cobrancaId, externalId: input.externalId });
    const r = await cancelInvoice({ agencyId: ctx.companyId, invoiceId, reason: input.motivo.trim(), actor: actorOf(ctx), source: sourceOf(ctx) });
    return ok(`🚫 Cobrança cancelada: ${r.clientName} — "${r.description}" (${brl(r.amountCents)}). Motivo: ${r.reason}.`, {
      data: r, link: appUrl(`/empresas/${r.clientCompanyId}?aba=financeiro`),
    });
  }),
};

type UpdInput = { cobrancaId: string; amountCents?: number; dueDate?: string; externalId?: string | null; description?: string; notes?: string | null; motivo?: string };

export const atualizarCobranca: ToolDef<UpdInput> = {
  name: "atualizar_cobranca",
  description:
    "Corrige uma cobrança: valor (amountCents, em centavos), vencimento (dueDate, 'YYYY-MM-DD'), ID externo (externalId no formato SISTEMA:número, ex.: ULTRA:931 / BLING:123 — liga a cobrança ao título no financeiro; único por empresa; null desliga), descrição e observações. Mande só o que muda e, de preferência, o motivo. Valor e vencimento só mudam em cobrança ABERTA (paga: estorne antes). Se o valor for reduzido até o que já foi recebido (diferença perdoada num pagamento parcial), a cobrança quita. EXECUTA NA HORA — confirme com o usuário antes.",
  input_schema: {
    type: "object",
    properties: {
      cobrancaId: { type: "string" },
      amountCents: { type: "integer", minimum: 0 },
      dueDate: { type: "string" },
      externalId: { type: ["string", "null"] },
      description: { type: "string" },
      notes: { type: ["string", "null"] },
      motivo: { type: "string" },
    },
    required: ["cobrancaId"],
  },
  mutating: true,
  confirm: true,
  summarize: (i) => `Atualizar a cobrança ${i.cobrancaId}: ${[
    i.amountCents !== undefined && `valor ${brl(i.amountCents)}`,
    i.dueDate && `vencimento ${i.dueDate}`,
    i.externalId !== undefined && `ID externo ${i.externalId ?? "(remover)"}`,
    i.description && `descrição "${i.description}"`,
    i.notes !== undefined && "observações",
  ].filter(Boolean).join(", ") || "nada"}`,
  run: (input, ctx) => guard(async () => {
    let due: Date | undefined;
    if (input.dueDate !== undefined) {
      const v = String(input.dueDate).trim();
      due = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00-03:00`) : (parseDate(v) ?? new Date(NaN));
    }
    const r = await updateInvoice({
      agencyId: ctx.companyId,
      invoiceId: input.cobrancaId,
      amountCents: input.amountCents,
      dueDate: due,
      externalId: input.externalId,
      description: input.description,
      notes: input.notes,
      reason: input.motivo ?? null,
      actor: actorOf(ctx),
      source: sourceOf(ctx),
    });
    if (r.changed.length === 0) return ok(`Nada mudou em "${r.description}" — os valores enviados já eram os atuais.`, { data: r });
    const tail = r.settled
      ? ` Com o novo valor, o que já tinha sido recebido (${brl(r.receivedCents)}) cobre a cobrança: ela foi QUITADA.`
      : r.receivedCents > 0 && r.balanceCents > 0 ? ` Já recebido ${brl(r.receivedCents)}; falta ${brl(r.balanceCents)}.` : "";
    return ok(`✏️ Cobrança "${r.description}" de ${r.clientName} atualizada (${r.changed.join(", ")}). Valor ${brl(r.amountCents)}.${tail}`, { data: r });
  }),
};

// ─── Fila do mês ────────────────────────────────────────────────────────────

export const filaCobranca: ToolDef<Record<string, never>> = {
  name: "fila_cobranca",
  description:
    "Situação financeira do mês: cobranças atrasadas, a vencer nos próximos 7 dias e contratos recorrentes que ainda não foram faturados neste mês. Resumo (até 20 por grupo) — a lista completa e filtrável é listar_cobrancas.",
  input_schema: { type: "object", properties: {} },
  run: async (_i, ctx) => {
    const now = ctx.now;
    const in7 = new Date(now); in7.setDate(in7.getDate() + 7);
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const sel = { id: true, description: true, amountCents: true, paidCents: true, status: true, dueDate: true, clientCompany: { select: { name: true } } } as const;

    const [overdue, upcoming, services, billed, skips] = await Promise.all([
      prisma.clientInvoice.findMany({
        where: { status: "ABERTO", dueDate: { lt: now }, clientCompany: { parentCompanyId: ctx.companyId } },
        select: sel, orderBy: { dueDate: "asc" }, take: 20,
      }),
      prisma.clientInvoice.findMany({
        where: { status: "ABERTO", dueDate: { gte: now, lte: in7 }, clientCompany: { parentCompanyId: ctx.companyId } },
        select: sel, orderBy: { dueDate: "asc" }, take: 20,
      }),
      prisma.clientService.findMany({
        where: { status: "ATIVO", isRecurring: true, amountCents: { gt: 0 }, clientCompany: { parentCompanyId: ctx.companyId } },
        select: { id: true, label: true, amountCents: true, status: true, isRecurring: true, billingCycle: true, renewsAt: true, startedAt: true, endedAt: true, clientCompany: { select: { name: true } } },
      }),
      prisma.clientInvoice.findMany({
        where: { referenceMonth: month, status: { not: "CANCELADO" }, clientServiceId: { not: null } },
        select: { clientServiceId: true },
      }),
      prisma.billingSkip.findMany({ where: { month }, select: { clientServiceId: true } }),
    ]);

    const { dueInMonth } = await import("@/app/(admin)/financeiro/lib");
    const billedSet = new Set(billed.map((b) => b.clientServiceId));
    const skipSet = new Set(skips.map((s) => s.clientServiceId));
    const pendentes = services.filter((s) => dueInMonth(s as any, month) && !billedSet.has(s.id) && !skipSet.has(s.id));

    // Saldo, não valor cheio: pagamento parcial já abateu parte.
    const desc = (i: (typeof overdue)[number]) => {
      const saldo = balanceCents(i);
      return `${i.clientCompany.name} ${brl(saldo)}${saldo !== i.amountCents ? ` (parcial, de ${brl(i.amountCents)})` : ""}`;
    };
    const out: string[] = [];
    out.push(`Atrasadas (${overdue.length}, ${brl(overdue.reduce((a, i) => a + balanceCents(i), 0))}): ${overdue.map((i) => `${desc(i)} venc. ${fmtDate(i.dueDate)}`).join("; ") || "nenhuma"}`);
    out.push(`A vencer em 7 dias (${upcoming.length}): ${upcoming.map((i) => `${desc(i)} ${fmtDate(i.dueDate)}`).join("; ") || "nenhuma"}`);
    out.push(`Contratos a faturar em ${month} (${pendentes.length}, ${brl(pendentes.reduce((a, s) => a + (s.amountCents ?? 0), 0))}): ${pendentes.map((s) => `${s.clientCompany.name} — ${s.label}`).join("; ") || "todos faturados"}`);
    out.push(`Link: ${appUrl("/financeiro/lancamentos")}`);
    return ok(out.join("\n"), { data: { overdue, upcoming, pendentes } });
  },
};

export const financeiroTools: ToolDef[] = [lancarCobranca, filaCobranca];

/** Gestão das cobranças (listar, baixar, estornar, cancelar, corrigir). Fica
 * separada porque entra no FIM do registry — ordem estável = cache de prompt. */
export const cobrancasTools: ToolDef[] = [
  listarCobrancas,
  registrarPagamento,
  registrarPagamentosLote,
  estornarPagamento,
  cancelarCobranca,
  atualizarCobranca,
];
