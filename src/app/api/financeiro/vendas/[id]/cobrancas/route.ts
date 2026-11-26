import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { invoiceCandidates } from "@/lib/sale-billing";

// GET /api/financeiro/vendas/[id]/cobrancas
// Cobranças que já existem na conta do cliente e podem ser ligadas a esta
// venda, em vez de gerar uma nova ao marcar "Faturado".
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const role = (session.user as any)?.role as string;
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  if (!isAdmin && !can(session, "canViewFinanceiro")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  const agencyId = (session.user as any)?.companyId as string | undefined;

  const { id } = await params;
  const sale = await prisma.sale.findUnique({
    where: { id },
    select: { id: true, companyId: true, clientCompanyId: true, valueCents: true },
  });
  if (!sale) return NextResponse.json({ error: "Venda não encontrada" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && sale.companyId !== agencyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  return NextResponse.json({ cobrancas: await invoiceCandidates(sale) });
}
