import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { getUserPermissions } from "@/lib/user-permissions";
import { prisma } from "@/lib/prisma";
import { deleteEmailFromServer } from "@/lib/imap-inbox";
import type { InboxEmailFolder } from "@/generated/prisma";

const MAX_IDS = 100;
const FOLDER_ACTIONS: Record<string, InboxEmailFolder> = {
  INBOX: "INBOX", IMPORTANT: "IMPORTANT", ARCHIVE: "ARCHIVE", SPAM: "SPAM", TRASH: "TRASH",
};

// POST /api/email/inbox/bulk
// { ids: string[], action: "INBOX"|"IMPORTANT"|"ARCHIVE"|"SPAM"|"TRASH"
//                        | "DELETE_SERVER" | "ADD_TAG" | "REMOVE_TAG"
//                        | "MARK_READ" | "MARK_UNREAD", tagId? }
// Ações em lote sobre emails selecionados. SPAM aplica blacklist por remetente
// (mesmo efeito do PATCH individual). DELETE_SERVER: exclusão definitiva —
// apaga do servidor IMAP (best-effort, com verificação de Message-ID) e do LeadHub.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return gate.response;
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.slice(0, MAX_IDS) : [];
  const action = String(body?.action ?? "").toUpperCase();
  if (!ids.length) return NextResponse.json({ error: "Nenhum email selecionado" }, { status: 400 });

  // Só emails da empresa da sessão.
  // Restrição por setor: só age nos emails de caixas liberadas.
  const perms = await getUserPermissions(session);
  const allowed = perms && !perms.isAdmin ? perms.emailAccountIds : null;

  const emailsRaw = await prisma.inboxEmail.findMany({
    where: { id: { in: ids }, companyId },
    select: { id: true, direction: true, fromEmail: true, folder: true, accountId: true },
  });
  const emails = allowed
    ? emailsRaw.filter((e) => e.accountId && allowed.includes(e.accountId))
    : emailsRaw;
  if (!emails.length) return NextResponse.json({ error: "Emails não encontrados" }, { status: 404 });
  const validIds = emails.map((e) => e.id);

  // ── Lido / não lido em massa ──
  if (action === "MARK_READ" || action === "MARK_UNREAD") {
    await prisma.inboxEmail.updateMany({
      where: { id: { in: validIds }, companyId },
      data: { seen: action === "MARK_READ" },
    });
    return NextResponse.json({ ok: true, affected: validIds.length });
  }

  // ── Tags ──
  if (action === "ADD_TAG" || action === "REMOVE_TAG") {
    const tagId = String(body?.tagId ?? "");
    const tag = await prisma.inboxEmailTag.findFirst({ where: { id: tagId, companyId }, select: { id: true } });
    if (!tag) return NextResponse.json({ error: "Tag não encontrada" }, { status: 404 });
    const op = action === "ADD_TAG" ? { connect: { id: tag.id } } : { disconnect: { id: tag.id } };
    for (const id of validIds) {
      await prisma.inboxEmail.update({ where: { id }, data: { tags: op } }).catch(() => null);
    }
    return NextResponse.json({ ok: true, affected: validIds.length });
  }

  // ── Exclusão definitiva (servidor + local) ──
  if (action === "DELETE_SERVER") {
    let serverDeleted = 0;
    for (const id of validIds) {
      const okServer = await deleteEmailFromServer(companyId, id);
      if (okServer) serverDeleted++;
    }
    await prisma.inboxEmail.deleteMany({ where: { id: { in: validIds }, companyId } });
    return NextResponse.json({ ok: true, affected: validIds.length, serverDeleted });
  }

  // ── Mover de pasta ──
  const folder = FOLDER_ACTIONS[action];
  if (!folder) return NextResponse.json({ error: "Ação inválida" }, { status: 400 });

  await prisma.inboxEmail.updateMany({
    where: { id: { in: validIds }, companyId },
    data: { folder },
  });

  // SPAM em lote: blacklist de cada remetente + arrasta os da Entrada junto.
  let rulesCreated = 0;
  if (folder === "SPAM") {
    const senders = [...new Set(
      emails.filter((e) => e.direction === "IN" && e.fromEmail).map((e) => e.fromEmail.toLowerCase())
    )];
    for (const fromEmail of senders) {
      await prisma.inboxSenderRule.upsert({
        where: { companyId_fromEmail: { companyId, fromEmail } },
        create: { companyId, fromEmail, type: "BLOCK" },
        update: { type: "BLOCK" },
      });
      rulesCreated++;
      await prisma.inboxEmail.updateMany({
        where: { companyId, fromEmail, folder: "INBOX", direction: "IN" },
        data: { folder: "SPAM" },
      });
    }
  }

  return NextResponse.json({ ok: true, affected: validIds.length, rulesCreated });
}
