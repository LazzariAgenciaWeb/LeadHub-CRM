import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

// Rascunhos do compositor. Salvos automaticamente enquanto a pessoa escreve —
// sair da tela pra buscar uma informação e voltar não perde o texto.
// Rascunho é PESSOAL: cada um vê e mexe só nos seus (filtro por userId).

const LIMITE = 50;

async function requireCtx() {
  const session = await getEffectiveSession();
  if (!session) return { ok: false as const, res: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return { ok: false as const, res: gate.response };
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return { ok: false as const, res: NextResponse.json({ error: "Sem empresa" }, { status: 400 }) };
  const userId = ((session.user as any).id ?? null) as string | null;
  return { ok: true as const, companyId, userId };
}

const texto = (v: unknown, max: number) => (typeof v === "string" ? v : "").slice(0, max);

// GET /api/email/inbox/drafts → meus rascunhos, mais recentes primeiro
export async function GET() {
  const ctx = await requireCtx();
  if (!ctx.ok) return ctx.res;

  const drafts = await prisma.emailDraft.findMany({
    where: { companyId: ctx.companyId, userId: ctx.userId },
    orderBy: { updatedAt: "desc" },
    take: LIMITE,
    select: {
      id: true, accountId: true, replyToId: true,
      toEmail: true, ccEmail: true, bccEmail: true, subject: true, textBody: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ drafts, count: drafts.length });
}

// POST /api/email/inbox/drafts  { id?, accountId?, replyToId?, to?, cc?, bcc?, subject?, text? }
// Com `id`, atualiza o rascunho (é o mesmo salvamento automático de sempre);
// sem `id`, cria. Devolve sempre o id pra UI continuar salvando no mesmo.
export async function POST(req: NextRequest) {
  const ctx = await requireCtx();
  if (!ctx.ok) return ctx.res;
  const body = await req.json().catch(() => ({}));

  const data = {
    accountId: body?.accountId ? String(body.accountId) : null,
    replyToId: body?.replyToId ? String(body.replyToId) : null,
    toEmail: texto(body?.to, 2000),
    ccEmail: texto(body?.cc, 2000),
    bccEmail: texto(body?.bcc, 2000),
    subject: texto(body?.subject, 500),
    textBody: texto(body?.text, 200_000),
  };

  if (body?.id) {
    // updateMany com o dono no where: id de outra pessoa/empresa não atualiza nada.
    const r = await prisma.emailDraft.updateMany({
      where: { id: String(body.id), companyId: ctx.companyId, userId: ctx.userId },
      data,
    });
    if (r.count === 0) return NextResponse.json({ error: "Rascunho não encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true, id: String(body.id), savedAt: new Date().toISOString() });
  }

  const draft = await prisma.emailDraft.create({
    data: { ...data, companyId: ctx.companyId, userId: ctx.userId },
    select: { id: true, updatedAt: true },
  });
  return NextResponse.json({ ok: true, id: draft.id, savedAt: draft.updatedAt });
}

// DELETE /api/email/inbox/drafts?id=…  → descartar (ou limpar depois do envio)
export async function DELETE(req: NextRequest) {
  const ctx = await requireCtx();
  if (!ctx.ok) return ctx.res;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Informe o id" }, { status: 400 });

  const r = await prisma.emailDraft.deleteMany({
    where: { id, companyId: ctx.companyId, userId: ctx.userId },
  });
  if (r.count === 0) return NextResponse.json({ error: "Rascunho não encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
