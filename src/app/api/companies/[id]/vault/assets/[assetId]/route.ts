import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import type { AssetStatus, AssetType } from "@/generated/prisma";

// PATCH /api/companies/[id]/vault/assets/[assetId]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  const { id: companyId, assetId } = await params;
  const auth = await authorizeVaultAccess(companyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) return NextResponse.json({ error: "Sem permissão de escrita" }, { status: 403 });

  const existing = await prisma.companyAsset.findUnique({ where: { id: assetId }, select: { companyId: true } });
  if (!existing || existing.companyId !== companyId) {
    return NextResponse.json({ error: "Asset não encontrado" }, { status: 404 });
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if ("name" in body) data.name = String(body.name).trim();
  if ("type" in body) data.type = body.type as AssetType;
  if ("url" in body) data.url = body.url || null;
  if ("host" in body) data.host = body.host || null;
  if ("identifier" in body) data.identifier = body.identifier || null;
  if ("provider" in body) data.provider = body.provider || null;
  if ("status" in body) data.status = body.status as AssetStatus;
  if ("expiresAt" in body) data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if ("notes" in body) data.notes = body.notes || null;
  if ("tags" in body) data.tags = Array.isArray(body.tags) ? body.tags : [];

  const asset = await prisma.companyAsset.update({ where: { id: assetId }, data });
  return NextResponse.json({ asset });
}

// DELETE /api/companies/[id]/vault/assets/[assetId]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  const { id: companyId, assetId } = await params;
  const auth = await authorizeVaultAccess(companyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) return NextResponse.json({ error: "Sem permissão de escrita" }, { status: 403 });

  const existing = await prisma.companyAsset.findUnique({ where: { id: assetId }, select: { companyId: true } });
  if (!existing || existing.companyId !== companyId) {
    return NextResponse.json({ error: "Asset não encontrado" }, { status: 404 });
  }

  await prisma.companyAsset.delete({ where: { id: assetId } });
  return NextResponse.json({ ok: true });
}
