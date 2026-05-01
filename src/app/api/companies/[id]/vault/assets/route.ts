import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import type { AssetType, AssetStatus } from "@/generated/prisma";

const ALLOWED_TYPES: AssetType[] = [
  "DOMAIN", "HOSTING", "WEBSITE", "EMAIL_ACCOUNT", "DATABASE",
  "DNS_PROVIDER", "REPOSITORY", "SOCIAL_ACCOUNT", "ANALYTICS", "CLOUD_SERVICE", "OTHER",
];

// GET /api/companies/[id]/vault/assets — lista ativos + credenciais (sem senha)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params;
  const auth = await authorizeVaultAccess(companyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const assets = await prisma.companyAsset.findMany({
    where: { companyId },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    include: {
      credentials: {
        select: {
          id: true, label: true, username: true, url: true,
          notes: true, lastRotatedAt: true, sharedWithClient: true,
          sharedAt: true, createdAt: true, updatedAt: true,
          // passwordEncrypted nunca é enviado na listagem
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return NextResponse.json({ assets, canWrite: auth.canWrite });
}

// POST /api/companies/[id]/vault/assets — cria asset
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params;
  const auth = await authorizeVaultAccess(companyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) return NextResponse.json({ error: "Sem permissão de escrita" }, { status: 403 });

  const body = await req.json();
  const type = body.type as AssetType;
  if (!type || !ALLOWED_TYPES.includes(type)) {
    return NextResponse.json({ error: "type inválido" }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name obrigatório" }, { status: 400 });
  }

  const asset = await prisma.companyAsset.create({
    data: {
      companyId,
      type,
      name: String(body.name).trim(),
      url: body.url || null,
      host: body.host || null,
      identifier: body.identifier || null,
      provider: body.provider || null,
      status: (body.status as AssetStatus) || "ACTIVE",
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      notes: body.notes || null,
      tags: Array.isArray(body.tags) ? body.tags : [],
      createdById: auth.userId,
    },
  });

  return NextResponse.json({ asset }, { status: 201 });
}
