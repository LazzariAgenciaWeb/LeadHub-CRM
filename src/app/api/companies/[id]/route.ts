import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/companies/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  // SUPER_ADMIN: acesso total
  // ADMIN: pode ver a própria empresa e sub-empresas (clientes)
  // CLIENT: apenas a própria empresa
  if (userRole !== "SUPER_ADMIN") {
    if (userCompanyId === id) {
      // própria empresa — sempre permitido
    } else if (userRole === "ADMIN") {
      // verifica se é sub-empresa do ADMIN
      const sub = await prisma.company.findFirst({ where: { id, parentCompanyId: userCompanyId } });
      if (!sub) return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
    } else {
      return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
    }
  }

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      campaigns: { orderBy: { createdAt: "desc" } },
      whatsappInstances: true,
      _count: { select: { leads: true, messages: true } },
    },
  });

  if (!company) {
    return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });
  }

  return NextResponse.json(company);
}

// PATCH /api/companies/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const userRole = (session.user as any).role;
  const isSuperAdmin = userRole === "SUPER_ADMIN";
  const userCompanyId = (session.user as any).companyId as string | undefined;

  // SUPER_ADMIN: acesso total
  // ADMIN: pode editar a própria empresa e sub-empresas
  // CLIENT: apenas a própria empresa
  if (!isSuperAdmin) {
    if (userCompanyId === id) {
      // própria empresa — ok
    } else if (userRole === "ADMIN") {
      const sub = await prisma.company.findFirst({ where: { id, parentCompanyId: userCompanyId } });
      if (!sub) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    } else {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
  }

  const body = await request.json();
  const {
    name, segment, phone, email, website, logoUrl, status, triggerOnly,
    // SUPER_ADMIN only
    hasSystemAccess, moduleWhatsapp, moduleCrm, moduleTickets, moduleAI, moduleClickup,
    moduleGamificacao, moduleProjetos, moduleCalendario, moduleProspeccao, moduleEmailMarketing, moduleInstagram, serpapiKey,
    modoAtendimento,
    parentCompanyId,
  } = body;

  // Campos que apenas SUPER_ADMIN pode alterar
  const adminOnlyData = isSuperAdmin
    ? {
        ...(status !== undefined && { status }),
        ...(triggerOnly !== undefined && { triggerOnly }),
        ...(hasSystemAccess !== undefined && { hasSystemAccess }),
        ...(moduleWhatsapp !== undefined && { moduleWhatsapp }),
        ...(moduleCrm !== undefined && { moduleCrm }),
        ...(moduleTickets !== undefined && { moduleTickets }),
        ...(moduleAI !== undefined && { moduleAI }),
        ...(moduleClickup !== undefined && { moduleClickup }),
        ...(moduleGamificacao !== undefined && { moduleGamificacao }),
        ...(moduleProjetos !== undefined && { moduleProjetos }),
        ...(moduleCalendario !== undefined && { moduleCalendario }),
        ...(moduleProspeccao !== undefined && { moduleProspeccao }),
        ...(moduleEmailMarketing !== undefined && { moduleEmailMarketing }),
        ...(moduleInstagram !== undefined && { moduleInstagram }),
        ...(serpapiKey !== undefined && { serpapiKey: serpapiKey || null }),
        ...(parentCompanyId !== undefined && { parentCompanyId: parentCompanyId || null }),
      }
    : {};

  const company = await prisma.company.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(segment !== undefined && { segment }),
      ...(phone !== undefined && { phone }),
      ...(email !== undefined && { email }),
      ...(website !== undefined && { website }),
      ...(logoUrl !== undefined && { logoUrl }),
      ...adminOnlyData,
    },
  });

  return NextResponse.json(company);
}

// DELETE /api/companies/[id]
// SUPER_ADMIN pode deletar qualquer empresa.
// ADMIN pode deletar apenas suas próprias sub-empresas (parentCompanyId === userCompanyId).
// Cascade nas FKs cuida de leads/mensagens/instâncias/etc., mas se houver sub-empresas
// filhas, exige limpeza prévia.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const isSuperAdmin = userRole === "SUPER_ADMIN";

  const { id } = await params;

  if (!isSuperAdmin) {
    if (userRole !== "ADMIN") {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const company = await prisma.company.findUnique({
      where: { id },
      select: { parentCompanyId: true },
    });
    if (!company || company.parentCompanyId !== userCompanyId) {
      return NextResponse.json(
        { error: "Você só pode deletar suas próprias sub-empresas." },
        { status: 403 }
      );
    }
  }

  // Bloqueia se houver sub-empresas — usuário precisa transferi-las primeiro
  const subCount = await prisma.company.count({ where: { parentCompanyId: id } });
  if (subCount > 0) {
    return NextResponse.json(
      { error: `Esta empresa tem ${subCount} sub-empresa(s) vinculada(s). Transfira-as primeiro antes de deletar.` },
      { status: 409 }
    );
  }

  try {
    await prisma.company.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[DELETE company]", err);
    return NextResponse.json(
      { error: err?.message ?? "Não foi possível deletar a empresa." },
      { status: 500 }
    );
  }
}
