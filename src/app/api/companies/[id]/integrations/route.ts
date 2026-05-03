import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { assertModule } from "@/lib/billing";

// GET /api/companies/[id]/integrations
// Lista integrações da empresa (sem expor tokens).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params;

  // fix A3 — gate de módulo marketing (integrações fazem parte do dashboard)
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "marketing");
  if (!gate.ok) return gate.response;

  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const integrations = await prisma.marketingIntegration.findMany({
    where: { companyId },
    orderBy: [{ provider: "asc" }, { createdAt: "desc" }],
    select: {
      id: true, provider: true, accountId: true, accountLabel: true,
      scopes: true, googleEmail: true, googleName: true,
      status: true, lastSyncAt: true, lastSyncStatus: true, lastError: true,
      tokenExpiresAt: true, createdAt: true,
    },
  });

  return NextResponse.json({ integrations, canWrite: auth.canWrite });
}
