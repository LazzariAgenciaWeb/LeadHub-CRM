import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/;

// Provedores públicos: bloquear o domínio inteiro mataria remetentes legítimos
// (clientes com gmail etc.) — regra de domínio recusada; bloqueie o email exato.
const PUBLIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "outlook.com.br",
  "live.com", "msn.com", "yahoo.com", "yahoo.com.br", "icloud.com", "me.com",
  "uol.com.br", "bol.com.br", "terra.com.br", "protonmail.com", "proton.me",
]);

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
// Aceita email exato ("x@dom.com") OU domínio inteiro ("@dom.com" / "dom.com").
// BLOCK: move os emails correspondentes da Entrada pro Spam.
// ALLOW: resgata os correspondentes do Spam pra Entrada.
export async function POST(req: NextRequest) {
  const ctx = await requireCtx();
  if (!ctx.ok) return ctx.res;
  const body = await req.json().catch(() => ({}));

  const input = String(body?.fromEmail ?? "").trim().toLowerCase();
  const type = body?.type === "ALLOW" ? "ALLOW" : "BLOCK";

  let ruleKey: string;
  let isDomain = false;
  if (EMAIL_RE.test(input)) {
    ruleKey = input;
  } else {
    const domain = input.replace(/^@/, "");
    if (!DOMAIN_RE.test(domain)) {
      return NextResponse.json({ error: "Informe um email (x@dominio.com) ou domínio (@dominio.com)" }, { status: 400 });
    }
    if (PUBLIC_DOMAINS.has(domain)) {
      return NextResponse.json(
        { error: `@${domain} é provedor público (clientes legítimos usam) — bloqueie o email exato em vez do domínio` },
        { status: 400 }
      );
    }
    ruleKey = `@${domain}`;
    isDomain = true;
  }

  await prisma.inboxSenderRule.upsert({
    where: { companyId_fromEmail: { companyId: ctx.companyId, fromEmail: ruleKey } },
    create: { companyId: ctx.companyId, fromEmail: ruleKey, type },
    update: { type },
  });

  // Filtro dos emails afetados: exato, ou o domínio INCLUINDO subdomínios
  // ("@dom.com" pega x@dom.com e x@sub.dom.com).
  const domainBare = ruleKey.slice(1); // sem o @
  const senderMatch: Prisma.InboxEmailWhereInput = isDomain
    ? { OR: [{ fromEmail: { endsWith: `@${domainBare}` } }, { fromEmail: { endsWith: `.${domainBare}` } }] }
    : { fromEmail: ruleKey };

  let moved = 0;
  if (type === "BLOCK") {
    const r = await prisma.inboxEmail.updateMany({
      where: { companyId: ctx.companyId, ...senderMatch, folder: "INBOX", direction: "IN" },
      data: { folder: "SPAM" },
    });
    moved = r.count;
  } else {
    const r = await prisma.inboxEmail.updateMany({
      where: { companyId: ctx.companyId, ...senderMatch, folder: "SPAM", direction: "IN" },
      data: { folder: "INBOX" },
    });
    moved = r.count;
  }
  return NextResponse.json({ ok: true, moved, rule: ruleKey });
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
