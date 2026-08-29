import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { logFinance, agencyOf } from "@/lib/finance-log";

// Autoriza: super-admin, ou a agência-mãe do cliente (parentCompanyId), ou a própria empresa.
async function authorize(session: any, companyId: string) {
  const role = session.user?.role as string;
  const userCompanyId = session.user?.companyId as string | undefined;
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, parentCompanyId: true },
  });
  if (!company) return { error: NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 }) };
  const ok = role === "SUPER_ADMIN" || company.parentCompanyId === userCompanyId || company.id === userCompanyId;
  if (!ok) return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  return { company };
}

// POST /api/empresas/[id]/financeiro
// Body: { clientServiceId?, description, referenceMonth?, amountCents, dueDate, boletoUrl?, invoiceUrl?, externalId?, notes? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const auth = await authorize(session, id);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const description = String(body?.description ?? "").trim();
  if (!description) return NextResponse.json({ error: "Descreva a cobrança" }, { status: 400 });

  const amountCents = Math.round(Number(body?.amountCents));
  if (!Number.isFinite(amountCents) || amountCents < 0) return NextResponse.json({ error: "Valor inválido" }, { status: 400 });

  const dueDate = body?.dueDate ? new Date(body.dueDate) : null;
  if (!dueDate || Number.isNaN(dueDate.getTime())) return NextResponse.json({ error: "Vencimento inválido" }, { status: 400 });

  // Se veio serviço, valida que pertence a esta empresa.
  let clientServiceId: string | null = null;
  if (body?.clientServiceId) {
    const cs = await prisma.clientService.findFirst({
      where: { id: String(body.clientServiceId), clientCompanyId: id },
      select: { id: true },
    });
    clientServiceId = cs?.id ?? null;
  }

  const created = await prisma.clientInvoice.create({
    data: {
      clientCompanyId: id,
      clientServiceId,
      description,
      referenceMonth: body?.referenceMonth ? String(body.referenceMonth).slice(0, 7) : null,
      amountCents,
      dueDate,
      status: "ABERTO",
      boletoUrl:  body?.boletoUrl ? String(body.boletoUrl).trim() : null,
      invoiceUrl: body?.invoiceUrl ? String(body.invoiceUrl).trim() : null,
      externalId: body?.externalId ? String(body.externalId).trim() : null,
      notes:      body?.notes ? String(body.notes) : null,
      provider:   "manual",
    },
    include: { clientService: { select: { id: true, label: true } } },
  });
  await logFinance({
    companyId: await agencyOf(id),
    clientCompanyId: id,
    entity: "COBRANCA",
    entityId: created.id,
    action: "CRIADO",
    meta: { descricao: created.description, competencia: created.referenceMonth, valorCents: created.amountCents },
    session,
  });
  return NextResponse.json(created, { status: 201 });
}
