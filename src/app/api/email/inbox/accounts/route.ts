import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { getUserPermissions } from "@/lib/user-permissions";
import { prisma } from "@/lib/prisma";
import { upsertEmailAccount } from "@/lib/imap-inbox";
import { ACCOUNT_SELECT, bodyToInput, resolveCompanyId, validateAccountBody } from "./helpers";

// GET /api/email/inbox/accounts?companyId=  → contas de email da empresa
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return gate.response;

  const companyId = resolveCompanyId(session, req.nextUrl.searchParams.get("companyId"));
  if (!companyId) return NextResponse.json({ accounts: [] });

  const perms = await getUserPermissions(session);
  const allowed = perms && !perms.isAdmin ? perms.emailAccountIds : null;

  const accounts = await prisma.emailAccount.findMany({
    where: { companyId },
    orderBy: { createdAt: "asc" },
    select: ACCOUNT_SELECT,
  });
  const visible = allowed ? accounts.filter((a) => allowed.includes(a.id)) : accounts;
  return NextResponse.json({
    accounts: visible.map((a) => ({ ...a, hasSmtpPassword: true, hasImapPassword: !!a.imapHost })),
  });
}

// POST /api/email/inbox/accounts  → cria conta nova
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return gate.response;

  if ((session.user as any).role === "CLIENT") {
    return NextResponse.json({ error: "Somente administradores gerenciam contas de email" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const companyId = resolveCompanyId(session, body?.companyId);
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const err = validateAccountBody(body, { requireSmtpPass: true });
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  try {
    const acc = await upsertEmailAccount(companyId, bodyToInput(body));
    return NextResponse.json({ ok: true, id: acc.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro ao salvar" }, { status: 400 });
  }
}
