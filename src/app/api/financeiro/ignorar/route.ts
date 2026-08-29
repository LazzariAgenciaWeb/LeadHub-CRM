import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { logFinance } from "@/lib/finance-log";

/**
 * Ignorar um contrato na fila "a faturar" de UMA competência, com motivo.
 *
 * Não é encerramento: mês que vem o contrato volta pra fila. É o combinado
 * pontual ("agosto virou cortesia da renovação") que antes ficava só na
 * cabeça — e na conferência ninguém sabia se faltou faturar ou se foi
 * decidido não faturar.
 *
 * POST   { month, serviceId, reason? }  → ignora
 * DELETE ?id=<skipId>                   → volta pra fila
 */
async function autorizar() {
  const session = await getEffectiveSession();
  if (!session) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const role = (session.user as any)?.role as string;
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  if (!isAdmin && !can(session, "canViewFinanceiro")) {
    return { erro: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  const agencyId = (session.user as any)?.companyId as string | undefined;
  const isGlobal = role === "SUPER_ADMIN" && !agencyId;
  return { session, agencyId, isGlobal };
}

export async function POST(req: NextRequest) {
  const auth = await autorizar();
  if ("erro" in auth) return auth.erro;

  const body = await req.json().catch(() => ({}));
  const month = String(body?.month ?? "");
  const serviceId = String(body?.serviceId ?? "");
  if (!/^\d{4}-\d{2}$/.test(month) || !serviceId) {
    return NextResponse.json({ error: "Competência ou contrato inválido" }, { status: 400 });
  }

  const cs = await prisma.clientService.findFirst({
    where: {
      id: serviceId,
      ...(auth.isGlobal
        ? { clientCompany: { parentCompanyId: { not: null } } }
        : { clientCompany: { parentCompanyId: auth.agencyId } }),
    },
    select: { id: true, label: true, clientCompanyId: true, amountCents: true },
  });
  if (!cs) return NextResponse.json({ error: "Contrato não encontrado nesta carteira" }, { status: 404 });

  const reason = body?.reason ? String(body.reason).trim() : null;
  const userName = (auth.session.user as any)?.name ?? (auth.session.user as any)?.email ?? null;

  // Upsert: ignorar de novo só atualiza o motivo, não duplica.
  const skip = await prisma.billingSkip.upsert({
    where: { clientServiceId_month: { clientServiceId: cs.id, month } },
    create: { clientServiceId: cs.id, month, reason, userName },
    update: { reason, userName },
  });

  await logFinance({
    companyId: auth.agencyId ?? "GLOBAL",
    clientCompanyId: cs.clientCompanyId,
    entity: "CONTRATO",
    entityId: cs.id,
    action: "IGNORADO",
    description: reason,
    meta: { contrato: cs.label, competencia: month, valorCents: cs.amountCents ?? 0 },
    session: auth.session,
  });

  return NextResponse.json(skip, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await autorizar();
  if ("erro" in auth) return auth.erro;

  const id = req.nextUrl.searchParams.get("id") ?? "";
  const skip = await prisma.billingSkip.findFirst({
    where: {
      id,
      ...(auth.isGlobal
        ? { clientService: { clientCompany: { parentCompanyId: { not: null } } } }
        : { clientService: { clientCompany: { parentCompanyId: auth.agencyId } } }),
    },
    include: { clientService: { select: { id: true, label: true, clientCompanyId: true } } },
  });
  if (!skip) return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });

  await prisma.billingSkip.delete({ where: { id: skip.id } });
  await logFinance({
    companyId: auth.agencyId ?? "GLOBAL",
    clientCompanyId: skip.clientService.clientCompanyId,
    entity: "CONTRATO",
    entityId: skip.clientService.id,
    action: "IGNORADO_REVERTIDO",
    meta: { contrato: skip.clientService.label, competencia: skip.month },
    session: auth.session,
  });
  return NextResponse.json({ ok: true });
}
