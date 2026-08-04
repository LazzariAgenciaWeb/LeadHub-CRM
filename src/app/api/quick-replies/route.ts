import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { getUserPermissions } from "@/lib/user-permissions";
import { prisma } from "@/lib/prisma";

// Respostas rápidas (atalhos de mensagem) do WhatsApp.
// Escopo: compartilhadas da empresa (userId null) + pessoais do usuário logado.
//
// GET  → lista visíveis (compartilhadas + minhas)
// POST → cria { shortcut, title, body, scope: "company" | "personal" }
//        scope "company" exige admin; "personal" qualquer um.

function normalizeShortcut(s: string): string {
  return String(s ?? "").trim().replace(/^\/+/, "").replace(/\s+/g, "").toLowerCase().slice(0, 40);
}

export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any)?.id as string | undefined;
  const companyId = (session.user as any)?.companyId as string | undefined;
  if (!companyId) return NextResponse.json({ quickReplies: [] });

  const rows = await prisma.quickReply.findMany({
    where: {
      companyId,
      OR: [{ userId: null }, { userId: userId ?? "__none__" }],
    },
    orderBy: [{ order: "asc" }, { title: "asc" }],
    select: {
      id: true, shortcut: true, title: true, body: true, order: true, userId: true,
    },
  });

  // Marca cada item: shared (empresa) x pessoal (meu)
  const quickReplies = rows.map((r) => ({
    ...r,
    scope: r.userId ? "personal" : "company",
    mine: r.userId === userId,
  }));

  return NextResponse.json({ quickReplies });
}

export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any)?.id as string | undefined;
  const companyId = (session.user as any)?.companyId as string | undefined;
  if (!companyId || !userId) return NextResponse.json({ error: "Sem empresa/usuário" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const shortcut = normalizeShortcut(body.shortcut);
  const title = String(body.title ?? "").trim().slice(0, 80);
  const text = String(body.body ?? "").trim();
  const scope = body.scope === "company" ? "company" : "personal";

  if (!title || !text) {
    return NextResponse.json({ error: "Título e mensagem são obrigatórios" }, { status: 400 });
  }

  // Compartilhada da empresa exige admin
  if (scope === "company") {
    const perms = await getUserPermissions(session);
    if (!perms?.isAdmin && !perms?.canManageUsers) {
      return NextResponse.json({ error: "Só administradores criam respostas compartilhadas" }, { status: 403 });
    }
  }

  const created = await prisma.quickReply.create({
    data: {
      shortcut,
      title,
      body: text,
      companyId,
      userId: scope === "company" ? null : userId,
    },
    select: { id: true, shortcut: true, title: true, body: true, order: true, userId: true },
  });

  return NextResponse.json({
    quickReply: { ...created, scope: created.userId ? "personal" : "company", mine: created.userId === userId },
  });
}
