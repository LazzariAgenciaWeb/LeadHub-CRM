import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { logFinance, agencyOf } from "@/lib/finance-log";

const STATUSES = ["ABERTO", "PAGO", "CANCELADO"];

async function loadAndAuth(session: any, companyId: string, invId: string) {
  const role = session.user?.role as string;
  const userCompanyId = session.user?.companyId as string | undefined;
  const inv = await prisma.clientInvoice.findUnique({
    where: { id: invId },
    include: { clientCompany: { select: { id: true, parentCompanyId: true } } },
  });
  if (!inv || inv.clientCompanyId !== companyId) return { error: NextResponse.json({ error: "Não encontrado" }, { status: 404 }) };
  const ok = role === "SUPER_ADMIN" || inv.clientCompany.parentCompanyId === userCompanyId || inv.clientCompany.id === userCompanyId;
  if (!ok) return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  return { inv };
}

// PATCH — atualiza campos; marcar "PAGO" grava data de liquidação (paidAt).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; invId: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id, invId } = await params;
  const res = await loadAndAuth(session, id, invId);
  if ("error" in res) return res.error;

  const body = await req.json().catch(() => ({}));
  const data: any = {};
  if (body.description !== undefined && String(body.description).trim()) data.description = String(body.description).trim();
  if (body.referenceMonth !== undefined) data.referenceMonth = body.referenceMonth ? String(body.referenceMonth).slice(0, 7) : null;
  if (body.amountCents !== undefined) {
    const c = Math.round(Number(body.amountCents));
    if (Number.isFinite(c) && c >= 0) data.amountCents = c;
  }
  if (body.dueDate !== undefined) {
    const d = body.dueDate ? new Date(body.dueDate) : null;
    if (d && !Number.isNaN(d.getTime())) data.dueDate = d;
  }
  if (body.boletoUrl !== undefined)  data.boletoUrl  = body.boletoUrl ? String(body.boletoUrl).trim() : null;
  if (body.invoiceUrl !== undefined) data.invoiceUrl = body.invoiceUrl ? String(body.invoiceUrl).trim() : null;
  if (body.externalId !== undefined) data.externalId = body.externalId ? String(body.externalId).trim() : null;
  if (body.notes !== undefined)      data.notes      = body.notes ? String(body.notes) : null;

  if (body.status !== undefined && STATUSES.includes(body.status)) {
    data.status = body.status;
    // Marcar pago sem data explícita → usa a data informada ou agora. Reabrir → limpa.
    if (body.status === "PAGO") {
      const p = body.paidAt ? new Date(body.paidAt) : new Date();
      data.paidAt = Number.isNaN(p.getTime()) ? new Date() : p;
    } else {
      data.paidAt = null;
    }
  } else if (body.paidAt !== undefined) {
    const p = body.paidAt ? new Date(body.paidAt) : null;
    data.paidAt = p && !Number.isNaN(p.getTime()) ? p : null;
  }

  const updated = await prisma.clientInvoice.update({
    where: { id: invId },
    data,
    include: { clientService: { select: { id: true, label: true } } },
  });

  // Trilha: mudança de status é o que importa na conferência (pagou? cancelou?
  // reabriu?); o resto vira ALTERADA com os campos tocados.
  {
    const antes = res.inv;
    const action =
      antes.status !== updated.status
        ? updated.status === "PAGO"
          ? "PAGO"
          : updated.status === "CANCELADO"
            ? "CANCELADO"
            : "REABERTO"
        : "ALTERADO";
    await logFinance({
      companyId: await agencyOf(id),
      clientCompanyId: id,
      entity: "COBRANCA",
      entityId: invId,
      action,
      description: body?.motivo ? String(body.motivo) : null,
      meta: {
        descricao: updated.description,
        competencia: updated.referenceMonth,
        valorCents: updated.amountCents,
        campos: Object.keys(data),
        ...(antes.status !== updated.status && { statusAntes: antes.status, statusDepois: updated.status }),
        ...(antes.amountCents !== updated.amountCents && { valorAntes: antes.amountCents }),
      },
      session,
    });
  }
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
