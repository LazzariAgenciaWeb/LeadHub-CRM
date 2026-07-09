import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// POST /api/meu-espaco/chamados
//
// Abertura de chamado (suporte) ou pedido (serviço pontual) PELO CLIENTE logado.
// Reaproveita o módulo de Chamados: cria um Ticket cuja empresa-dona é a AGÊNCIA
// (parentCompanyId do cliente) e cujo clientCompany é a empresa do próprio cliente
// — assim cai no fluxo normal de atendimento da AZZ.
//
// Body: { kind: "SUPPORT" | "REQUEST", title, description, serviceId? }
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const companyId = (session.user as any)?.companyId as string | undefined;
  const userId    = (session.user as any)?.id as string | undefined;
  const userName  = (session.user as any)?.name as string | undefined;
  const role      = (session.user as any)?.role as string | undefined;
  if (!companyId || role === "SUPER_ADMIN") {
    return NextResponse.json({ error: "Ação disponível apenas para clientes." }, { status: 403 });
  }

  // A empresa precisa ser um cliente (sub-company); a dona do ticket é a agência-mãe.
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, parentCompanyId: true },
  });
  if (!company?.parentCompanyId) {
    return NextResponse.json({ error: "Apenas empresas cliente podem abrir chamados aqui." }, { status: 403 });
  }
  const agencyId = company.parentCompanyId;

  const body = await req.json();
  const kind = body?.kind === "REQUEST" ? "REQUEST" : "SUPPORT";
  const title = String(body?.title ?? "").trim();
  const description = String(body?.description ?? "").trim();
  const serviceId = body?.serviceId ? String(body.serviceId) : null;

  if (!title) return NextResponse.json({ error: "Descreva o assunto." }, { status: 400 });

  // Se veio de um serviço do catálogo (pedido), amarra o nome no corpo.
  let finalTitle = title;
  let finalDesc = description || title;
  if (serviceId) {
    const svc = await prisma.service.findFirst({
      where: { id: serviceId, companyId: agencyId, isActive: true },
      select: { name: true },
    });
    if (svc) {
      finalTitle = `Interesse: ${svc.name}${title ? ` — ${title}` : ""}`;
      finalDesc = `${description || "Tenho interesse neste serviço."}\n\n(Serviço: ${svc.name})`;
    }
  }

  // Categoria distingue Suporte × Pedido na visão da agência.
  const category = kind === "REQUEST" ? "Pedido" : "Suporte";
  // Cliente não define prazo — usa um default de 7 dias (dueDate é obrigatório).
  const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const ticket = await prisma.ticket.create({
    data: {
      title:           finalTitle,
      description:     finalDesc,
      priority:        "MEDIUM",
      category,
      type:            "SUPPORT", // fluxo de atendimento normal da agência
      companyId:       agencyId,
      clientCompanyId: companyId,
      createdById:     userId ?? null,
      dueDate,
      visibility:      "OPEN",
      messages: {
        create: {
          body:       finalDesc,
          authorName: userName ?? company.name,
          authorRole: role ?? "CLIENT",
          isInternal: false,
          source:     "LEADHUB",
        },
      },
    },
    select: { id: true, title: true, category: true, status: true, createdAt: true },
  });

  return NextResponse.json({ ok: true, ticket }, { status: 201 });
}
