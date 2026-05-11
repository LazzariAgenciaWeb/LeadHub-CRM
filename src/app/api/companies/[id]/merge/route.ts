import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { mergeCompany } from "@/lib/company-merge";

// POST /api/companies/[id]/merge
// Body: { targetId: string }
// Mescla a empresa [id] (origem) na empresa targetId (destino) e deleta a origem.
// SUPER_ADMIN: pode mesclar quaisquer empresas.
// ADMIN: pode mesclar entre suas próprias sub-empresas (origem e destino com parentCompanyId === userCompanyId).
// Usa getServerSession (sessão real) — não respeita impersonation.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const isSuperAdmin = userRole === "SUPER_ADMIN";

  const { id: sourceId } = await params;
  const body = await req.json().catch(() => ({}));
  const targetId = body?.targetId as string | undefined;

  if (!targetId || typeof targetId !== "string") {
    return NextResponse.json(
      { error: "targetId é obrigatório no body." },
      { status: 400 }
    );
  }
  if (targetId === sourceId) {
    return NextResponse.json(
      { error: "Empresa origem e destino são iguais." },
      { status: 400 }
    );
  }

  if (!isSuperAdmin) {
    if (userRole !== "ADMIN") {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const [src, dst] = await Promise.all([
      prisma.company.findUnique({ where: { id: sourceId }, select: { parentCompanyId: true } }),
      prisma.company.findUnique({ where: { id: targetId }, select: { parentCompanyId: true } }),
    ]);
    if (
      !src ||
      !dst ||
      src.parentCompanyId !== userCompanyId ||
      dst.parentCompanyId !== userCompanyId
    ) {
      return NextResponse.json(
        { error: "Você só pode mesclar entre suas próprias sub-empresas." },
        { status: 403 }
      );
    }
  }

  try {
    const result = await mergeCompany(sourceId, targetId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[POST /api/companies/[id]/merge]", err);
    return NextResponse.json(
      { error: err?.message ?? "Falha ao mesclar empresas." },
      { status: 500 }
    );
  }
}
