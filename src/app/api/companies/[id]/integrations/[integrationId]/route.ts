import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";

// PATCH /api/companies/[id]/integrations/[integrationId]
// Atualiza accountId/accountLabel (após o usuário escolher a propriedade GA4 / site SC).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; integrationId: string }> }
) {
  const { id: companyId, integrationId } = await params;
  const auth = await authorizeVaultAccess(companyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const existing = await prisma.marketingIntegration.findUnique({
    where: { id: integrationId },
    select: { companyId: true },
  });
  if (!existing || existing.companyId !== companyId) {
    return NextResponse.json({ error: "Integração não encontrada" }, { status: 404 });
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if ("accountId" in body) data.accountId = body.accountId || null;
  if ("accountLabel" in body) data.accountLabel = body.accountLabel || null;

  const updated = await prisma.marketingIntegration.update({
    where: { id: integrationId },
    data,
    select: {
      id: true, provider: true, accountId: true, accountLabel: true,
      status: true, lastSyncAt: true,
    },
  });
  return NextResponse.json({ integration: updated });
}

// DELETE /api/companies/[id]/integrations/[integrationId]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; integrationId: string }> }
) {
  const { id: companyId, integrationId } = await params;
  const auth = await authorizeVaultAccess(companyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const existing = await prisma.marketingIntegration.findUnique({
    where: { id: integrationId },
    select: { companyId: true },
  });
  if (!existing || existing.companyId !== companyId) {
    return NextResponse.json({ error: "Integração não encontrada" }, { status: 404 });
  }

  // Marca como DISCONNECTED em vez de deletar (preserva histórico de snapshots vinculados ao company)
  // Mas o usuário consegue reconectar criando um novo registro
  await prisma.marketingIntegration.delete({ where: { id: integrationId } });
  return NextResponse.json({ ok: true });
}
