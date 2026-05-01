import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { tryDecryptSecret } from "@/lib/crypto";

// POST /api/companies/[id]/vault/credentials/[credentialId]/reveal
// Body: { action?: "REVEAL" | "COPY" | "SHARE" }  default: REVEAL
// Retorna a senha em texto claro e registra log de acesso.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; credentialId: string }> }
) {
  const { id: companyId, credentialId } = await params;
  const auth = await authorizeVaultAccess(companyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const cred = await prisma.companyCredential.findUnique({
    where: { id: credentialId },
    select: { id: true, passwordEncrypted: true, asset: { select: { companyId: true } } },
  });
  if (!cred || cred.asset.companyId !== companyId) {
    return NextResponse.json({ error: "Credencial não encontrada" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const action = (body.action as string) || "REVEAL";
  const allowed = ["REVEAL", "COPY", "SHARE"];
  if (!allowed.includes(action)) {
    return NextResponse.json({ error: "action inválida" }, { status: 400 });
  }

  const password = tryDecryptSecret(cred.passwordEncrypted);
  if (password === null && cred.passwordEncrypted) {
    return NextResponse.json(
      { error: "Falha ao decriptar (chave trocada ou payload corrompido)" },
      { status: 500 }
    );
  }

  // Audit log
  await prisma.credentialAccessLog.create({
    data: {
      credentialId,
      companyId,
      userId: auth.userId,
      userName: auth.userName,
      userRole: auth.userRole,
      action: action as "REVEAL" | "COPY" | "SHARE",
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: req.headers.get("user-agent") || null,
    },
  });

  // Marca como compartilhada se action=SHARE
  if (action === "SHARE") {
    await prisma.companyCredential.update({
      where: { id: credentialId },
      data: { sharedWithClient: true, sharedAt: new Date() },
    });
  }

  return NextResponse.json({ password: password || "" });
}
