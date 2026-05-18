import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { encryptSecret } from "@/lib/crypto";

async function loadAndCheck(companyId: string, credentialId: string) {
  const cred = await prisma.companyCredential.findUnique({
    where: { id: credentialId },
    select: { id: true, archivedAt: true, asset: { select: { companyId: true } } },
  });
  if (!cred || cred.asset.companyId !== companyId) return null;
  return cred;
}

// PATCH /api/companies/[id]/vault/credentials/[credentialId]
// Edição normal; ou restauração de um registro arquivado (body { restore: true },
// apenas admin).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; credentialId: string }> }
) {
  const { id: companyId, credentialId } = await params;
  const auth = await authorizeVaultAccess(companyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) return NextResponse.json({ error: "Sem permissão de escrita" }, { status: 403 });

  const cred = await loadAndCheck(companyId, credentialId);
  if (!cred) return NextResponse.json({ error: "Credencial não encontrada" }, { status: 404 });

  const body = await req.json();

  // Restaurar credencial arquivada — só admin (canDelete).
  if (body.restore === true) {
    if (!auth.canDelete) {
      return NextResponse.json({ error: "Apenas admin pode restaurar" }, { status: 403 });
    }
    await prisma.companyCredential.update({
      where: { id: credentialId },
      data: { archivedAt: null, archivedById: null, archivedByName: null },
    });
    await prisma.credentialAccessLog.create({
      data: {
        credentialId,
        companyId,
        userId: auth.userId,
        userName: auth.userName,
        userRole: auth.userRole,
        action: "RESTORE",
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
        userAgent: req.headers.get("user-agent") || null,
      },
    });
    return NextResponse.json({ ok: true });
  }

  // Edição de credencial arquivada só faz sentido depois de restaurar.
  if (cred.archivedAt) {
    return NextResponse.json({ error: "Credencial arquivada — restaure antes de editar" }, { status: 409 });
  }

  const data: Record<string, unknown> = {};
  if ("label" in body) data.label = String(body.label).trim();
  if ("username" in body) data.username = body.username || null;
  if ("url" in body) data.url = body.url || null;
  if ("notes" in body) data.notes = body.notes || null;
  if ("sharedWithClient" in body) {
    data.sharedWithClient = !!body.sharedWithClient;
    data.sharedAt = body.sharedWithClient ? new Date() : null;
  }
  if ("password" in body) {
    if (body.password) {
      data.passwordEncrypted = encryptSecret(String(body.password));
      data.lastRotatedAt = new Date();
    } else {
      data.passwordEncrypted = null;
    }
  }

  const updated = await prisma.companyCredential.update({
    where: { id: credentialId },
    data,
    select: {
      id: true, label: true, username: true, url: true, notes: true,
      lastRotatedAt: true, sharedWithClient: true, sharedAt: true,
      createdAt: true, updatedAt: true,
    },
  });

  await prisma.credentialAccessLog.create({
    data: {
      credentialId,
      companyId,
      userId: auth.userId,
      userName: auth.userName,
      userRole: auth.userRole,
      action: "EDIT",
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: req.headers.get("user-agent") || null,
    },
  });

  return NextResponse.json({ credential: updated });
}

// DELETE /api/companies/[id]/vault/credentials/[credentialId]
// Admin (canDelete): exclui de vez. CLIENT: arquiva (soft-delete) — sai da
// lista, mas admin ainda vê e pode restaurar.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; credentialId: string }> }
) {
  const { id: companyId, credentialId } = await params;
  const auth = await authorizeVaultAccess(companyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) return NextResponse.json({ error: "Sem permissão de escrita" }, { status: 403 });

  const cred = await loadAndCheck(companyId, credentialId);
  if (!cred) return NextResponse.json({ error: "Credencial não encontrada" }, { status: 404 });

  const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const userAgent = req.headers.get("user-agent") || null;

  // CLIENT → arquiva em vez de apagar
  if (!auth.canDelete) {
    if (cred.archivedAt) {
      return NextResponse.json({ ok: true, archived: true });
    }
    await prisma.companyCredential.update({
      where: { id: credentialId },
      data: {
        archivedAt: new Date(),
        archivedById: auth.userId,
        archivedByName: auth.userName,
      },
    });
    await prisma.credentialAccessLog.create({
      data: {
        credentialId,
        companyId,
        userId: auth.userId,
        userName: auth.userName,
        userRole: auth.userRole,
        action: "ARCHIVE",
        ipAddress,
        userAgent,
      },
    });
    return NextResponse.json({ ok: true, archived: true });
  }

  // Admin → exclusão definitiva. Log antes (cascade apaga os logs antigos junto).
  await prisma.credentialAccessLog.create({
    data: {
      credentialId,
      companyId,
      userId: auth.userId,
      userName: auth.userName,
      userRole: auth.userRole,
      action: "DELETE",
      ipAddress,
      userAgent,
    },
  });

  await prisma.companyCredential.delete({ where: { id: credentialId } });
  return NextResponse.json({ ok: true });
}
