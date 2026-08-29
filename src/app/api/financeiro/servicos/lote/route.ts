import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";

/**
 * POST /api/financeiro/servicos/lote
 * Body: { serviceIds: string[], catalogServiceId?: string | null, label?: string }
 *
 * Padroniza serviços contratados em massa: vincula todos ao mesmo serviço do
 * catálogo e/ou renomeia o rótulo. Existe porque a importação do ClickUp
 * trouxe a mesma hospedagem com dezenas de nomes diferentes e sem vínculo —
 * e ajustar um a um dentro de cada empresa não escala.
 */
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any)?.role as string;
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  if (!isAdmin && !can(session, "canViewFinanceiro")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  const agencyId = (session.user as any)?.companyId as string | undefined;
  const isGlobal = role === "SUPER_ADMIN" && !agencyId;

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.serviceIds) ? body.serviceIds.map(String).slice(0, 500) : [];
  if (ids.length === 0) return NextResponse.json({ error: "Nenhum serviço informado" }, { status: 400 });

  const data: Record<string, unknown> = {};

  // Vincular ao catálogo (ou desvincular com null explícito).
  if (body?.catalogServiceId !== undefined) {
    if (body.catalogServiceId === null || body.catalogServiceId === "") {
      data.serviceId = null;
    } else {
      const svc = await prisma.service.findFirst({
        where: {
          id: String(body.catalogServiceId),
          ...(isGlobal ? {} : { companyId: agencyId }),
        },
        select: { id: true },
      });
      if (!svc) return NextResponse.json({ error: "Serviço do catálogo não encontrado" }, { status: 400 });
      data.serviceId = svc.id;
    }
  }
  if (body?.label !== undefined && String(body.label).trim()) {
    data.label = String(body.label).trim();
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada pra atualizar — informe o serviço do catálogo e/ou o rótulo" }, { status: 400 });
  }

  // Só a própria carteira; ids de fora caem no where e nunca são atualizados.
  const escopo = isGlobal
    ? { clientCompany: { parentCompanyId: { not: null } } }
    : { clientCompany: { parentCompanyId: agencyId } };
  const alvo = await prisma.clientService.findMany({
    where: { id: { in: ids }, ...escopo },
    select: { id: true, label: true, clientCompanyId: true },
  });
  if (alvo.length === 0) return NextResponse.json({ updated: 0 });

  const r = await prisma.clientService.updateMany({
    where: { id: { in: alvo.map((a) => a.id) } },
    data,
  });

  const userName = (session.user as any)?.name ?? (session.user as any)?.email ?? null;
  await prisma.financeLog
    .createMany({
      data: alvo.map((a) => ({
        companyId: agencyId ?? "GLOBAL",
        clientCompanyId: a.clientCompanyId,
        entity: "CONTRATO",
        entityId: a.id,
        action: "ALTERADO",
        description: "Padronização em massa de serviços",
        meta: {
          contrato: a.label,
          ...(data.label !== undefined && { novoRotulo: data.label }),
          ...(data.serviceId !== undefined && { catalogo: data.serviceId }),
        },
        userName,
      })),
    })
    .catch((e) => console.error("[finance-log servicos-lote]", e));

  return NextResponse.json({ updated: r.count });
}
