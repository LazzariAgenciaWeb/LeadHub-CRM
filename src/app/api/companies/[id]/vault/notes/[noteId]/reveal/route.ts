import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { tryDecryptSecret } from "@/lib/crypto";
import { getActiveTrustedSession } from "@/lib/vault-2fa";

// POST /api/companies/[id]/vault/notes/[noteId]/reveal
// Body: { action?: "REVEAL" | "COPY" }  default: REVEAL
//
// Pré-requisito: VaultTrustedSession ativa (a mesma das credenciais — criada
// via /api/vault/verify após validar código de e-mail). Sem ela retorna 403
// com requires2FA:true. Retorna o conteúdo em texto claro e registra o log.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const { id: companyId, noteId } = await params;
  const auth = await authorizeVaultAccess(companyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // 2FA: exige sessão de confiança ativa
  const trustedUntil = await getActiveTrustedSession(auth.userId);
  if (!trustedUntil) {
    return NextResponse.json(
      { error: "Verificação por e-mail necessária", requires2FA: true },
      { status: 403 },
    );
  }

  const note = await prisma.companySecureNote.findUnique({
    where: { id: noteId },
    select: { id: true, contentEncrypted: true, companyId: true },
  });
  if (!note || note.companyId !== companyId) {
    return NextResponse.json({ error: "Nota não encontrada" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const action = (body.action as string) || "REVEAL";
  if (!["REVEAL", "COPY"].includes(action)) {
    return NextResponse.json({ error: "action inválida" }, { status: 400 });
  }

  const content = tryDecryptSecret(note.contentEncrypted);
  if (content === null && note.contentEncrypted) {
    return NextResponse.json(
      { error: "Falha ao decriptar (chave trocada ou payload corrompido)" },
      { status: 500 },
    );
  }

  await prisma.secureNoteAccessLog.create({
    data: {
      noteId,
      companyId,
      userId: auth.userId,
      userName: auth.userName,
      userRole: auth.userRole,
      action: action as "REVEAL" | "COPY",
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: req.headers.get("user-agent") || null,
    },
  });

  return NextResponse.json({ content: content || "" });
}
