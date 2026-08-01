import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function requireCtx() {
  const session = await getEffectiveSession();
  if (!session) return { ok: false as const, res: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return { ok: false as const, res: gate.response };
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return { ok: false as const, res: NextResponse.json({ error: "Sem empresa" }, { status: 400 }) };
  return { ok: true as const, companyId };
}

// GET /api/email/inbox/rules → blacklist (BLOCK) e whitelist (ALLOW) da empresa
export async function GET() {
  const ctx = await requireCtx();
  if (!ctx.ok) return ctx.res;

  const rules = await prisma.inboxSenderRule.findMany({
    where: { companyId: ctx.companyId },
    orderBy: [{ type: "asc" }, { createdAt: "desc" }],
    select: { id: true, fromEmail: true, type: true, createdAt: true },
  });
  return NextResponse.json({ rules });
}

// POST /api/email/inbox/rules  { fromEmail, type: "BLOCK" | "ALLOW" }
// BLOCK: move os emails do remetente que estão na Entrada pro Spam.
// ALLOW: resgata os emails do remetente que estão no Spam pra Entrada.
export async function POST(req: NextRequest) {
  const ctx = await requireCtx();
  if (!ctx.ok) return ctx.res;
  const body = await req.json().catch(() => ({}));

  const fromEmail = String(body?.fromEmail ?? "").trim().toLowerCase();
  const type = body?.type === "ALLOW" ? "ALLOW" : "BLOCK";
  if (!EMAIL_RE.test(fromEmail)) {
    return NextResponse.json({ error: "Email inválido" }, { status: 400 });
  }

  await prisma.inboxSenderRule.upsert({
    where: { companyId_fromEmail: { companyId: ctx.companyId, fromEmail } },
    create: { companyId: ctx.companyId, fromEmail, type },
    update: { type },
  });

  let moved = 0;
  if (type === "BLOCK") {
    const r = await prisma.inboxEmail.updateMany({
      where: { companyId: ctx.companyId, fromEmail, folder: "INBOX", direction: "IN" },
      data: { folder: "SPAM" },
    });
    moved = r.count;
  } else {
    const r = await prisma.inboxEmail.updateMany({
      where: { companyId: ctx.companyId, fromEmail, folder: "SPAM", direction: "IN" },
      data: { folder: "INBOX" },
    });
    moved = r.count;
  }
  return NextResponse.json({ ok: true, moved });
}

// DELETE /api/email/inbox/rules?id=  → remove a regra
export async function DELETE(req: NextRequest) {
  const ctx = await requireCtx();
  if (!ctx.ok) return ctx.res;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const del = await prisma.inboxSenderRule.deleteMany({ where: { id, companyId: ctx.companyId } });
  if (!del.count) return NextResponse.json({ error: "Regra não encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
