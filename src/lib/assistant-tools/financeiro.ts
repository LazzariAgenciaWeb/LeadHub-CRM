import { prisma } from "@/lib/prisma";
import { logFinance } from "@/lib/finance-log";
import { type ToolDef, ok, fail, appUrl, parseDate, fmtDate, brl } from "./types";

/**
 * Financeiro. Lançar cobrança EXIGE confirmação explícita (confirm: true) —
 * erro aqui custa dinheiro e constrangimento com o cliente.
 */

export const lancarCobranca: ToolDef<{ clientCompanyId: string; description: string; amountCents: number; dueDate: string; referenceMonth?: string; notes?: string }> = {
  name: "lancar_cobranca",
  description:
    "Lança uma cobrança (fatura) manual para um cliente. amountCents em CENTAVOS (R$ 1.500,00 = 150000). dueDate ISO 8601. referenceMonth opcional 'YYYY-MM'. Esta ação pede confirmação do usuário antes de executar.",
  input_schema: {
    type: "object",
    properties: {
      clientCompanyId: { type: "string" },
      description: { type: "string" },
      amountCents: { type: "integer", minimum: 0 },
      dueDate: { type: "string" },
      referenceMonth: { type: "string" },
      notes: { type: "string" },
    },
    required: ["clientCompanyId", "description", "amountCents", "dueDate"],
  },
  mutating: true,
  confirm: true,
  summarize: (i) => `Lançar cobrança de ${brl(i.amountCents)} — "${i.description}" — vencimento ${fmtDate(parseDate(i.dueDate))}`,
  run: async (input, ctx) => {
    const client = await prisma.company.findFirst({ where: { id: input.clientCompanyId, parentCompanyId: ctx.companyId }, select: { id: true, name: true } });
    if (!client) return fail("Cliente não encontrado na carteira.");
    const due = parseDate(input.dueDate);
    if (!due) return fail("dueDate inválido.");
    if (!Number.isInteger(input.amountCents) || input.amountCents < 0) return fail("amountCents inválido.");

    const inv = await prisma.clientInvoice.create({
      data: {
        clientCompanyId: client.id,
        description: input.description.trim(),
        amountCents: input.amountCents,
        dueDate: due,
        referenceMonth: input.referenceMonth?.trim() || null,
        notes: input.notes?.trim() || null,
        status: "ABERTO",
        provider: "manual",
      },
      select: { id: true },
    });
    await logFinance({
      companyId: ctx.companyId, clientCompanyId: client.id, entity: "COBRANCA", entityId: inv.id, action: "CRIADO",
      description: `${input.description.trim()} · ${brl(input.amountCents)} (assistente)`,
      session: { user: { name: ctx.userName } },
    });
    return ok(`💰 Cobrança lançada para ${client.name}: ${brl(input.amountCents)} · "${input.description.trim()}" · vence ${fmtDate(due)}`, {
      data: { id: inv.id }, link: appUrl(`/empresas/${client.id}?aba=financeiro`),
    });
  },
};

export const filaCobranca: ToolDef<Record<string, never>> = {
  name: "fila_cobranca",
  description:
    "Situação financeira do mês: cobranças atrasadas, a vencer nos próximos 7 dias e contratos recorrentes que ainda não foram faturados neste mês.",
  input_schema: { type: "object", properties: {} },
  run: async (_i, ctx) => {
    const now = ctx.now;
    const in7 = new Date(now); in7.setDate(in7.getDate() + 7);
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const [overdue, upcoming, services, billed, skips] = await Promise.all([
      prisma.clientInvoice.findMany({
        where: { status: "ABERTO", dueDate: { lt: now }, clientCompany: { parentCompanyId: ctx.companyId } },
        select: { id: true, description: true, amountCents: true, dueDate: true, clientCompany: { select: { name: true } } },
        orderBy: { dueDate: "asc" }, take: 20,
      }),
      prisma.clientInvoice.findMany({
        where: { status: "ABERTO", dueDate: { gte: now, lte: in7 }, clientCompany: { parentCompanyId: ctx.companyId } },
        select: { id: true, description: true, amountCents: true, dueDate: true, clientCompany: { select: { name: true } } },
        orderBy: { dueDate: "asc" }, take: 20,
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

    const out: string[] = [];
    out.push(`Atrasadas (${overdue.length}, ${brl(overdue.reduce((a, i) => a + i.amountCents, 0))}): ${overdue.map((i) => `${i.clientCompany.name} ${brl(i.amountCents)} venc. ${fmtDate(i.dueDate)}`).join("; ") || "nenhuma"}`);
    out.push(`A vencer em 7 dias (${upcoming.length}): ${upcoming.map((i) => `${i.clientCompany.name} ${brl(i.amountCents)} ${fmtDate(i.dueDate)}`).join("; ") || "nenhuma"}`);
    out.push(`Contratos a faturar em ${month} (${pendentes.length}, ${brl(pendentes.reduce((a, s) => a + (s.amountCents ?? 0), 0))}): ${pendentes.map((s) => `${s.clientCompany.name} — ${s.label}`).join("; ") || "todos faturados"}`);
    out.push(`Link: ${appUrl("/financeiro/lancamentos")}`);
    return ok(out.join("\n"), { data: { overdue, upcoming, pendentes } });
  },
};

export const financeiroTools: ToolDef[] = [lancarCobranca, filaCobranca];
