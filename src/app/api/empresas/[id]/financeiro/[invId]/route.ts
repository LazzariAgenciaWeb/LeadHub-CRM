import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { logFinance, agencyOf } from "@/lib/finance-log";
import {
  InvoiceOpError, cancelInvoice, normalizeExternalId, receivedCents, registerInvoicePayment,
  reopenCanceledInvoice, reverseInvoicePayment, withExternalIdLock,
} from "@/lib/invoice-ops";

const STATUSES = ["ABERTO", "PAGO", "CANCELADO"];

async function loadAndAuth(session: any, companyId: string, invId: string) {
  const role = session.user?.role as string;
  const userCompanyId = session.user?.companyId as string | undefined;
  const inv = await prisma.clientInvoice.findUnique({
    where: { id: invId },
    include: { clientCompany: { select: { id: true, parentCompanyId: true } } },
  });
  if (!inv || inv.clientCompanyId !== companyId) return { error: NextResponse.json({ error: "Não encontrado" }, { status: 404 }) };
  // Financeiro do cliente é dado sensível: além do vínculo com a empresa,
  // atendente (CLIENT) precisa do setor com "Financeiro" liberado.
  const ok = can(session, "canViewFinanceiro") && (role === "SUPER_ADMIN" || inv.clientCompany.parentCompanyId === userCompanyId || inv.clientCompany.id === userCompanyId);
  if (!ok) return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  return { inv };
}

// PATCH — atualiza campos e muda status. Baixa, estorno, cancelamento e
// reabertura passam por src/lib/invoice-ops.ts — a MESMA regra que o
// assistente/MCP usa (registrar_pagamento, estornar_pagamento…).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; invId: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id, invId } = await params;
  const res = await loadAndAuth(session, id, invId);
  if ("error" in res) return res.error;

  const body = await req.json().catch(() => ({}));
  const antes = res.inv;
  const agencyId = await agencyOf(id);
  const actor = { name: (session.user?.name ?? session.user?.email ?? null) as string | null };
  const motivo = body?.motivo ? String(body.motivo) : null;

  // ── 1) Campos (só o que de fato mudou) ──
  const data: any = {};
  const set = (k: string, v: unknown, atual: unknown) => {
    const a = atual instanceof Date ? atual.getTime() : atual;
    const b = v instanceof Date ? v.getTime() : v;
    if (a !== b) data[k] = v;
  };
  if (body.description !== undefined && String(body.description).trim()) set("description", String(body.description).trim(), antes.description);
  if (body.referenceMonth !== undefined) set("referenceMonth", body.referenceMonth ? String(body.referenceMonth).slice(0, 7) : null, antes.referenceMonth);
  if (body.amountCents !== undefined) {
    const c = Math.round(Number(body.amountCents));
    if (Number.isFinite(c) && c >= 0) set("amountCents", c, antes.amountCents);
  }
  if (body.dueDate !== undefined) {
    const d = body.dueDate ? new Date(body.dueDate) : null;
    if (d && !Number.isNaN(d.getTime())) set("dueDate", d, antes.dueDate);
  }
  if (body.boletoUrl !== undefined)  set("boletoUrl", body.boletoUrl ? String(body.boletoUrl).trim() : null, antes.boletoUrl);
  if (body.invoiceUrl !== undefined) set("invoiceUrl", body.invoiceUrl ? String(body.invoiceUrl).trim() : null, antes.invoiceUrl);
  if (body.externalId !== undefined) set("externalId", normalizeExternalId(body.externalId), antes.externalId);
  if (body.notes !== undefined)      set("notes", body.notes ? String(body.notes) : null, antes.notes);

  const target: string = body.status !== undefined && STATUSES.includes(body.status) ? body.status : antes.status;
  // Corrigir a data de liquidação de uma cobrança que já estava (e segue) paga.
  if (target === "PAGO" && antes.status === "PAGO" && body.paidAt) {
    const p = new Date(body.paidAt);
    if (!Number.isNaN(p.getTime()) && p.getTime() !== antes.paidAt?.getTime()) { data.paidAt = p; data.lastPaymentAt = p; }
  }

  try {
    if (Object.keys(data).length > 0) {
      await withExternalIdLock(agencyId, data.externalId ?? null, invId, (tx) => tx.clientInvoice.update({ where: { id: invId }, data }));
      await logFinance({
        companyId: agencyId,
        clientCompanyId: id,
        entity: "COBRANCA",
        entityId: invId,
        action: "ALTERADO",
        description: target === antes.status ? motivo : null,
        meta: {
          descricao: data.description ?? antes.description,
          competencia: data.referenceMonth !== undefined ? data.referenceMonth : antes.referenceMonth,
          valorCents: data.amountCents ?? antes.amountCents,
          campos: Object.keys(data),
          ...(data.amountCents !== undefined && { valorAntes: antes.amountCents }),
          ...(data.externalId !== undefined && { externalIdAntes: antes.externalId }),
          origem: "tela",
        },
        session,
      });
    }

    // ── 2) Mudança de status — sempre pela regra compartilhada ──
    if (target !== antes.status) {
      const base = { agencyId, invoiceId: invId, actor, source: "tela" };
      const temRecebimento = receivedCents(antes) > 0;
      if (antes.status === "CANCELADO") await reopenCanceledInvoice({ ...base, reason: motivo });
      if (target === "PAGO") {
        const p = body.paidAt ? new Date(body.paidAt) : null;
        // A tela não tem campo de valor recebido: marcar pago = recebeu o saldo.
        await registerInvoicePayment({ ...base, paidAt: p && !Number.isNaN(p.getTime()) ? p : null, note: motivo });
      } else if (target === "ABERTO") {
        if (antes.status === "PAGO") await reverseInvoicePayment({ ...base, reason: motivo });
      } else if (target === "CANCELADO") {
        if (antes.status === "PAGO" || temRecebimento) await reverseInvoicePayment({ ...base, reason: motivo });
        await cancelInvoice({ ...base, reason: motivo });
      }
    }
  } catch (e) {
    if (e instanceof InvoiceOpError) {
      const status = e.code === "NAO_ENCONTRADA" ? 404 : e.code === "INVALIDO" ? 400 : 409;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    throw e;
  }

  const updated = await prisma.clientInvoice.findUnique({
    where: { id: invId },
    include: { clientService: { select: { id: true, label: true } } },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; invId: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id, invId } = await params;
  const res = await loadAndAuth(session, id, invId);
  if ("error" in res) return res.error;
  await prisma.clientInvoice.delete({ where: { id: invId } });
  // O registro sobrevive à cobrança de propósito — é a prova de que existiu.
  await logFinance({
    companyId: await agencyOf(id),
    clientCompanyId: id,
    entity: "COBRANCA",
    entityId: invId,
    action: "EXCLUIDO",
    meta: {
      descricao: res.inv.description,
      competencia: res.inv.referenceMonth,
      valorCents: res.inv.amountCents,
      status: res.inv.status,
    },
    session,
  });
  return NextResponse.json({ ok: true });
}
