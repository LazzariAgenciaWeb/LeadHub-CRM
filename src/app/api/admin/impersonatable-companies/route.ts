import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/impersonatable-companies
 *
 * Lista TODAS as empresas com `hasSystemAccess = true`, ordenadas por nome.
 * Usado pelo dropdown do Sidebar do SuperAdmin para impersonar.
 *
 * IMPORTANTE: ignora hierarquia (parentCompanyId) — qualquer empresa com painel
 * ativo deve ser impersonável, seja top-level ou sub-empresa de outra.
 *
 * Restrito a SUPER_ADMIN (usa getServerSession para ler a sessão REAL,
 * mesmo durante impersonação ativa).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const companies = await prisma.company.findMany({
    where: { hasSystemAccess: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      hasSystemAccess: true,
      parentCompanyId: true,
      parentCompany: { select: { name: true } },
    },
  });

  return NextResponse.json(companies);
}
