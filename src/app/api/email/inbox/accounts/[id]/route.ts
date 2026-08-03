import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { upsertEmailAccount } from "@/lib/imap-inbox";
import { bodyToInput, resolveCompanyId, validateAccountBody } from "../helpers";

async function requireCtx(explicitCompanyId?: string | null) {
  const session = await getEffectiveSession();
  if (!session) return { ok: false as const, res: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return { ok: false as const, res: gate.response };
  if ((session.user as any).role === "CLIENT") {
    return { ok: false as const, res: NextResponse.json({ error: "Somente administradores gerenciam contas de email" }, { status: 403 }) };
  }
  const companyId = resolveCompanyId(session, explicitCompanyId);
  if (!companyId) return { ok: false as const, res: NextResponse.json({ error: "Sem empresa" }, { status: 400 }) };
  return { ok: true as const, companyId };
}

// PUT /api/email/inbox/accounts/[id]  → atualiza conta (senha vazia = mantém)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const body = await req.json().catch(() => ({}));
  const ctx = await requireCtx(body?.companyId);
  if (!ctx.ok) return ctx.res;
  const { id } = await params;

  const err = validateAccountBody(body, { requireSmtpPass: false });
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  try {
    await upsertEmailAccount(ctx.companyId, bodyToInput(body), id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro ao salvar" }, { status: 400 });
  }
}

// DELETE /api/email/inbox/accounts/[id]  → remove a conta.
// Os emails já importados ficam (InboxEmail.accountId vira null via SetNull).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx(req.nextUrl.searchParams.get("companyId"));
  if (!ctx.ok) return ctx.res;
  const { id } = await params;

  const acc = await prisma.emailAccount.findFirst({ where: { id, companyId: ctx.companyId }, select: { id: true } });
  if (!acc) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });

  await prisma.emailAccount.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
