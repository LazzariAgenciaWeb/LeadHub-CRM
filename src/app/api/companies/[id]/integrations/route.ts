import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";

// GET /api/companies/[id]/integrations
// Lista integrações da empresa (sem expor tokens).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params;
  const auth = await authorizeVaultAccess(companyId);
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
