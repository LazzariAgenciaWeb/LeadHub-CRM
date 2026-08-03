import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

async function requireCtx() {
  const session = await getEffectiveSession();
  if (!session) return { ok: false as const, res: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return { ok: false as const, res: gate.response };
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return { ok: false as const, res: NextResponse.json({ error: "Sem empresa" }, { status: 400 }) };
  return { ok: true as const, companyId };
}

// GET /api/email/inbox/tags → tags da empresa (com contagem de uso)
export async function GET() {
  const ctx = await requireCtx();
  if (!ctx.ok) return ctx.res;

  const tags = await prisma.inboxEmailTag.findMany({
    where: { companyId: ctx.companyId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true, _count: { select: { emails: true } } },
  });
  return NextResponse.json({
    tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color, count: t._count.emails })),
  });
}

// POST /api/email/inbox/tags  { name, color? } → cria tag
export async function POST(req: NextRequest) {
  const ctx = await requireCtx();
  if (!ctx.ok) return ctx.res;
  const body = await req.json().catch(() => ({}));

  const name = String(body?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });
  if (name.length > 30) return NextResponse.json({ error: "Nome muito longo (máx 30)" }, { status: 400 });
  const color = /^#[0-9a-fA-F]{6}$/.test(String(body?.color ?? "")) ? body.color : "#6366f1";

  try {
    const tag = await prisma.inboxEmailTag.create({
      data: { companyId: ctx.companyId, name, color },
      select: { id: true, name: true, color: true },
    });
    return NextResponse.json({ ok: true, tag });
  } catch {
    return NextResponse.json({ error: "Já existe uma tag com esse nome" }, { status: 400 });
  }
}

// DELETE /api/email/inbox/tags?id=  → remove a tag (sai de todos os emails)
export async function DELETE(req: NextRequest) {
  const ctx = await requireCtx();
  if (!ctx.ok) return ctx.res;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const del = await prisma.inboxEmailTag.deleteMany({ where: { id, companyId: ctx.companyId } });
  if (!del.count) return NextResponse.json({ error: "Tag não encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
