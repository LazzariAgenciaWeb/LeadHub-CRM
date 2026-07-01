import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { encryptSecret } from "@/lib/crypto";

// GET /api/companies/[id]/vault/notes — lista notas seguras (SEM o conteúdo).
//
// O título é retornado; o conteúdo criptografado nunca vai na listagem — só
// via /notes/[noteId]/reveal (com 2FA). Por padrão esconde arquivadas; admin
// pode pedir ?includeArchived=1.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params;
  const auth = await authorizeVaultAccess(companyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const includeArchived =
    auth.canDelete && req.nextUrl.searchParams.get("includeArchived") === "1";

  const notes = await prisma.companySecureNote.findMany({
    where: {
      companyId,
      ...(includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, title: true, createdAt: true, updatedAt: true,
      archivedAt: true, archivedByName: true,
      // contentEncrypted nunca é enviado na listagem
    },
  });

  return NextResponse.json({
    notes,
    canWrite: auth.canWrite,
    canDelete: auth.canDelete,
    includeArchived,
  });
}

// POST /api/companies/[id]/vault/notes — cria nota segura (criptografa conteúdo)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params;
  const auth = await authorizeVaultAccess(companyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) return NextResponse.json({ error: "Sem permissão de escrita" }, { status: 403 });

  const body = await req.json();
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title obrigatório" }, { status: 400 });
  }
  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim()) {
    return NextResponse.json({ error: "content obrigatório" }, { status: 400 });
  }

  const note = await prisma.companySecureNote.create({
    data: {
      companyId,
      title: String(body.title).trim(),
      contentEncrypted: encryptSecret(content),
      createdById: auth.userId,
    },
    select: {
      id: true, title: true, createdAt: true, updatedAt: true,
      archivedAt: true, archivedByName: true,
    },
  });

  await prisma.secureNoteAccessLog.create({
    data: {
      noteId: note.id,
      companyId,
      userId: auth.userId,
      userName: auth.userName,
      userRole: auth.userRole,
      action: "CREATE",
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: req.headers.get("user-agent") || null,
    },
  });

  return NextResponse.json({ note }, { status: 201 });
}
