import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { encryptSecret } from "@/lib/crypto";

// POST /api/companies/[id]/vault/assets/[assetId]/credentials — cria credencial
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  const { id: companyId, assetId } = await params;
  const auth = await authorizeVaultAccess(companyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) return NextResponse.json({ error: "Sem permissão de escrita" }, { status: 403 });

  const asset = await prisma.companyAsset.findUnique({
    where: { id: assetId },
    select: { companyId: true },
  });
  if (!asset || asset.companyId !== companyId) {
    return NextResponse.json({ error: "Asset não encontrado" }, { status: 404 });
  }

  const body = await req.json();
  if (!body.label?.trim()) {
    return NextResponse.json({ error: "label obrigatório" }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  const encrypted = password ? encryptSecret(password) : null;

  const credential = await prisma.companyCredential.create({
    data: {
      assetId,
      label: String(body.label).trim(),
      username: body.username || null,
      passwordEncrypted: encrypted,
      url: body.url || null,
      notes: body.notes || null,
      lastRotatedAt: password ? new Date() : null,
      createdById: auth.userId,
    },
    select: {
      id: true, label: true, username: true, url: true, notes: true,
      lastRotatedAt: true, sharedWithClient: true, sharedAt: true,
      createdAt: true, updatedAt: true,
    },
  });

  // Log de criação
  await prisma.credentialAccessLog.create({
    data: {
      credentialId: credential.id,
      companyId,
      userId: auth.userId,
      userName: auth.userName,
      userRole: auth.userRole,
      action: "CREATE",
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: req.headers.get("user-agent") || null,
    },
  });

  return NextResponse.json({ credential }, { status: 201 });
}
