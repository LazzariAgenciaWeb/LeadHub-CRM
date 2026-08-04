import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { getUserPermissions } from "@/lib/user-permissions";
import { prisma } from "@/lib/prisma";

// PATCH  → edita { shortcut?, title?, body? }
// DELETE → remove
// Regras: pessoal → só o dono; compartilhada (userId null) → só admin.

function normalizeShortcut(s: string): string {
  return String(s ?? "").trim().replace(/^\/+/, "").replace(/\s+/g, "").toLowerCase().slice(0, 40);
}

async function loadAndAuthorize(id: string, session: any) {
  const userId = (session.user as any)?.id as string | undefined;
  const companyId = (session.user as any)?.companyId as string | undefined;
  const qr = await prisma.quickReply.findUnique({ where: { id } });
  if (!qr || qr.companyId !== companyId) return { error: NextResponse.json({ error: "Não encontrada" }, { status: 404 }) };

  if (qr.userId) {
    // pessoal — só o dono
    if (qr.userId !== userId) return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  } else {
    // compartilhada — só admin
    const perms = await getUserPermissions(session);
    if (!perms?.isAdmin && !perms?.canManageUsers) {
      return { error: NextResponse.json({ error: "Só administradores editam respostas compartilhadas" }, { status: 403 }) };
    }
  }
  return { qr, userId };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;

  const auth = await loadAndAuthorize(id, session);
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const data: any = {};
  if (body.shortcut !== undefined) data.shortcut = normalizeShortcut(body.shortcut);
  if (body.title !== undefined) data.title = String(body.title).trim().slice(0, 80);
  if (body.body !== undefined) data.body = String(body.body).trim();
  if (typeof body.order === "number") data.order = body.order;

  if (data.title === "" || data.body === "") {
    return NextResponse.json({ error: "Título e mensagem não podem ficar vazios" }, { status: 400 });
  }

  const updated = await prisma.quickReply.update({
    where: { id },
    data,
    select: { id: true, shortcut: true, title: true, body: true, order: true, userId: true },
  });

  return NextResponse.json({
    quickReply: { ...updated, scope: updated.userId ? "personal" : "company", mine: updated.userId === auth.userId },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;

  const auth = await loadAndAuthorize(id, session);
  if (auth.error) return auth.error;

  await prisma.quickReply.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
