import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import type { InboxEmailFolder } from "@/generated/prisma";

const FOLDERS: InboxEmailFolder[] = ["INBOX", "IMPORTANT", "SENT", "ARCHIVE", "SPAM", "TRASH"];

async function requireCtx() {
  const session = await getEffectiveSession();
  if (!session) return { ok: false as const, res: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return { ok: false as const, res: gate.response };
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return { ok: false as const, res: NextResponse.json({ error: "Sem empresa" }, { status: 400 }) };
  return { ok: true as const, companyId };
}

// GET /api/email/inbox/[id] → email completo (marca como lido).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  if (!ctx.ok) return ctx.res;
  const { id } = await params;

  const email = await prisma.inboxEmail.findFirst({
    where: { id, companyId: ctx.companyId },
    select: {
      id: true, direction: true, folder: true, messageId: true,
      fromEmail: true, fromName: true, toEmail: true,
      subject: true, textBody: true, htmlBody: true,
      inReplyTo: true, seen: true, sentAt: true,
      aiImportance: true, aiSummary: true,
      leadId: true, ticketId: true, accountId: true,
      account: { select: { id: true, label: true, fromEmail: true } },
      lead: { select: { id: true, name: true, email: true, pipeline: true } },
      ticket: { select: { id: true, title: true } },
    },
  });
  if (!email) return NextResponse.json({ error: "Email não encontrado" }, { status: 404 });

  if (!email.seen) {
    await prisma.inboxEmail.update({ where: { id: email.id }, data: { seen: true } });
  }
  return NextResponse.json({ email: { ...email, seen: true } });
}

// PATCH /api/email/inbox/[id]  { folder?, seen?, leadId?, ticketId? }
// Move entre pastas (importante/resolvido/spam/lixeira/restaurar) e ajusta
// vínculos. Efeitos colaterais de spam:
//   → SPAM (email recebido): cria regra BLOCK do remetente e move os demais
//     emails dele que estão na Entrada pro Spam.
//   SPAM → INBOX: remove a regra BLOCK (deixa de ser blacklist).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  if (!ctx.ok) return ctx.res;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const existing = await prisma.inboxEmail.findFirst({
    where: { id, companyId: ctx.companyId },
    select: { id: true, folder: true, direction: true, fromEmail: true },
  });
  if (!existing) return NextResponse.json({ error: "Email não encontrado" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (body.folder !== undefined) {
    const folder = String(body.folder).toUpperCase() as InboxEmailFolder;
    if (!FOLDERS.includes(folder)) {
      return NextResponse.json({ error: "Pasta inválida" }, { status: 400 });
    }
    data.folder = folder;
  }
  if (body.seen !== undefined) data.seen = !!body.seen;
  if (body.leadId !== undefined) data.leadId = body.leadId || null;
  if (body.ticketId !== undefined) data.ticketId = body.ticketId || null;
  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "Nada pra atualizar" }, { status: 400 });
  }

  const updated = await prisma.inboxEmail.update({
    where: { id },
    data,
    select: { id: true, folder: true, seen: true, leadId: true, ticketId: true },
  });

  // ── Regras de remetente (blacklist automática) ──────────────────────────
  let ruleCreated: string | null = null;
  let ruleRemoved: string | null = null;
  let movedToSpam = 0;
  const sender = existing.fromEmail?.toLowerCase();
  const newFolder = data.folder as InboxEmailFolder | undefined;

  if (newFolder === "SPAM" && existing.direction === "IN" && sender) {
    await prisma.inboxSenderRule.upsert({
      where: { companyId_fromEmail: { companyId: ctx.companyId, fromEmail: sender } },
      create: { companyId: ctx.companyId, fromEmail: sender, type: "BLOCK" },
      update: { type: "BLOCK" },
    });
    ruleCreated = sender;
    const moved = await prisma.inboxEmail.updateMany({
      where: { companyId: ctx.companyId, fromEmail: sender, folder: "INBOX", direction: "IN" },
      data: { folder: "SPAM" },
    });
    movedToSpam = moved.count;
  } else if (existing.folder === "SPAM" && newFolder === "INBOX" && sender) {
    const del = await prisma.inboxSenderRule.deleteMany({
      where: { companyId: ctx.companyId, fromEmail: sender, type: "BLOCK" },
    });
    if (del.count > 0) ruleRemoved = sender;
  }

  return NextResponse.json({ ok: true, email: updated, ruleCreated, ruleRemoved, movedToSpam });
}
