import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { encryptSecret } from "@/lib/crypto";

async function loadAndCheck(companyId: string, noteId: string) {
  const note = await prisma.companySecureNote.findUnique({
    where: { id: noteId },
    select: { id: true, archivedAt: true, companyId: true },
  });
  if (!note || note.companyId !== companyId) return null;
  return note;
}

// PATCH /api/companies/[id]/vault/notes/[noteId]
// Edição normal (title/content); ou restauração de nota arquivada
// (body { restore: true }, apenas admin).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const { id: companyId, noteId } = await params;
  const auth = await authorizeVaultAccess(companyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) return NextResponse.json({ error: "Sem permissão de escrita" }, { status: 403 });

  const note = await loadAndCheck(companyId, noteId);
  if (!note) return NextResponse.json({ error: "Nota não encontrada" }, { status: 404 });

  const body = await req.json();

  // Restaurar nota arquivada — só admin (canDelete).
  if (body.restore === true) {
    if (!auth.canDelete) {
      return NextResponse.json({ error: "Apenas admin pode restaurar" }, { status: 403 });
    }
    await prisma.companySecureNote.update({
      where: { id: noteId },
      data: { archivedAt: null, archivedById: null, archivedByName: null },
    });
    await logAccess(req, { noteId, companyId, auth, action: "RESTORE" });
    return NextResponse.json({ ok: true });
  }

  if (note.archivedAt) {
    return NextResponse.json({ error: "Nota arquivada — restaure antes de editar" }, { status: 409 });
  }

  const data: Record<string, unknown> = {};
  if ("title" in body) {
    if (!body.title?.trim()) return NextResponse.json({ error: "title não pode ficar vazio" }, { status: 400 });
    data.title = String(body.title).trim();
  }
  // Conteúdo só é reencriptado quando enviado (edição sem re-digitar mantém o atual).
  if ("content" in body && typeof body.content === "string" && body.content.length > 0) {
    data.contentEncrypted = encryptSecret(body.content);
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const updated = await prisma.companySecureNote.update({
    where: { id: noteId },
    data,
    select: {
      id: true, title: true, createdAt: true, updatedAt: true,
      archivedAt: true, archivedByName: true,
    },
  });

  await logAccess(req, { noteId, companyId, auth, action: "EDIT" });
  return NextResponse.json({ note: updated });
}

// DELETE /api/companies/[id]/vault/notes/[noteId]
// Admin (canDelete): exclui de vez. CLIENT: arquiva (soft-delete).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const { id: companyId, noteId } = await params;
  const auth = await authorizeVaultAccess(companyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) return NextResponse.json({ error: "Sem permissão de escrita" }, { status: 403 });

  const note = await loadAndCheck(companyId, noteId);
  if (!note) return NextResponse.json({ error: "Nota não encontrada" }, { status: 404 });

  // CLIENT → arquiva em vez de apagar
  if (!auth.canDelete) {
    if (note.archivedAt) return NextResponse.json({ ok: true, archived: true });
    await prisma.companySecureNote.update({
      where: { id: noteId },
      data: {
        archivedAt: new Date(),
        archivedById: auth.userId,
        archivedByName: auth.userName,
      },
    });
    await logAccess(req, { noteId, companyId, auth, action: "ARCHIVE" });
    return NextResponse.json({ ok: true, archived: true });
  }

  // Admin → exclusão definitiva. Log antes (cascade apaga os logs junto).
  await logAccess(req, { noteId, companyId, auth, action: "DELETE" });
  await prisma.companySecureNote.delete({ where: { id: noteId } });
  return NextResponse.json({ ok: true });
}

async function logAccess(
  req: NextRequest,
  opts: {
    noteId: string;
    companyId: string;
    auth: { userId: string; userName: string; userRole: string };
    action: "EDIT" | "DELETE" | "ARCHIVE" | "RESTORE";
  },
) {
  await prisma.secureNoteAccessLog.create({
    data: {
      noteId: opts.noteId,
      companyId: opts.companyId,
      userId: opts.auth.userId,
      userName: opts.auth.userName,
      userRole: opts.auth.userRole,
      action: opts.action,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: req.headers.get("user-agent") || null,
    },
  });
}
