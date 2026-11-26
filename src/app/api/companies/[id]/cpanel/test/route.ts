import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { testCpanelConnection } from "@/lib/cpanel";

// POST /api/companies/[id]/cpanel/test → testa a conexão salva (lista a pasta
// de publicação) e grava o resultado. Mesmo recorte da config: ADMIN/SUPER_ADMIN.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await params;
  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canDelete) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const test = await testCpanelConnection(companyId);
  const cfg = await prisma.cpanelIntegration.findUnique({
    where: { companyId },
    select: { status: true, lastTestedAt: true, lastError: true },
  });
  return NextResponse.json({ test, config: cfg });
}
