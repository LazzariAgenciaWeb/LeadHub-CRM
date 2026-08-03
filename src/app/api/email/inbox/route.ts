import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { getUserPermissions } from "@/lib/user-permissions";
import { prisma } from "@/lib/prisma";
import type { InboxEmailFolder, Prisma } from "@/generated/prisma";

const FOLDERS: InboxEmailFolder[] = ["INBOX", "IMPORTANT", "SENT", "ARCHIVE", "SPAM", "TRASH"];

// GET /api/email/inbox?folder=INBOX&q=&skip=&take=&leadId=&ticketId=&accountId=
// Lista emails da caixa da empresa + contadores por pasta + contas cadastradas.
// Com leadId/ticketId, ignora pasta e lista o histórico do vínculo (lixeira fora).
// accountId filtra por conta (etiqueta de qual caixa o email entrou/saiu).
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailInbox");
  if (!gate.ok) return gate.response;

  const sp = req.nextUrl.searchParams;
  const role = (session.user as any).role as string;
  const companyId = role === "SUPER_ADMIN"
    ? (sp.get("companyId") ?? (session.user as any).companyId)
    : (session.user as any).companyId;
  if (!companyId) return NextResponse.json({ emails: [], counts: {}, unseen: 0 });

  // Restrição por setor: CLIENT pode estar limitado a caixas específicas
  // (SetorEmailAccount). null = sem restrição (admin ou setor sem vínculos).
  const perms = await getUserPermissions(session);
  const allowed = perms && !perms.isAdmin ? perms.emailAccountIds : null;
  if (allowed && allowed.length === 0) {
    return NextResponse.json({ emails: [], counts: {}, unseen: 0, accounts: [], tagCounts: {} });
  }

  const leadId = sp.get("leadId");
  const ticketId = sp.get("ticketId");
  const accountId = sp.get("accountId");
  const tagId = sp.get("tagId");
  // Filtro pela triagem IA: ALTA | NORMAL | BAIXA | NONE (ainda sem análise)
  const importanceParam = sp.get("importance")?.toUpperCase() ?? null;
  const importance = ["ALTA", "NORMAL", "BAIXA", "NONE"].includes(importanceParam ?? "")
    ? importanceParam
    : null;
  const q = sp.get("q")?.trim();
  const skip = Math.max(0, parseInt(sp.get("skip") ?? "0", 10) || 0);
  const take = Math.min(100, Math.max(1, parseInt(sp.get("take") ?? "50", 10) || 50));

  // "ALL" = pseudo-pasta "Todos": busca/lista atravessando todas as pastas.
  const folderParam = (sp.get("folder") ?? "INBOX").toUpperCase();
  const isAll = folderParam === "ALL";
  const folder = FOLDERS.includes(folderParam as InboxEmailFolder)
    ? (folderParam as InboxEmailFolder)
    : "INBOX";

  const where: Prisma.InboxEmailWhereInput = { companyId };
  if (leadId || ticketId) {
    if (leadId) where.leadId = leadId;
    if (ticketId) where.ticketId = ticketId;
    where.folder = { not: "TRASH" };
  } else if (!isAll) {
    where.folder = folder;
  }
  const accountScope: Prisma.InboxEmailWhereInput = allowed
    ? { accountId: accountId && allowed.includes(accountId) ? accountId : { in: allowed } }
    : accountId ? { accountId } : {};
  Object.assign(where, accountScope);
  // tagId "__none" = pseudo-tag "sem tag": emails sem nenhuma marcação.
  if (tagId === "__none") where.tags = { none: {} };
  else if (tagId) where.tags = { some: { id: tagId } };
  if (importance) where.aiImportance = importance === "NONE" ? null : importance;
  if (q) {
    where.OR = [
      { subject: { contains: q, mode: "insensitive" } },
      { fromEmail: { contains: q, mode: "insensitive" } },
      { fromName: { contains: q, mode: "insensitive" } },
      { toEmail: { contains: q, mode: "insensitive" } },
      { snippet: { contains: q, mode: "insensitive" } },
    ];
  }

  // Contadores respeitam o filtro de conta (etiqueta selecionada).
  const countScope: Prisma.InboxEmailWhereInput = { companyId, ...accountScope };
  // Contagem das tags escopada na PASTA atual (+ conta): na Entrada, o chip
  // da tag mostra só quantos emails daquela tag estão na Entrada. Em "Todos",
  // conta geral.
  const tagScope: Prisma.InboxEmailWhereInput = isAll ? countScope : { ...countScope, folder };

  const [emails, grouped, unseen, accounts, tagCountRows, noTagCount] = await Promise.all([
    prisma.inboxEmail.findMany({
      where,
      orderBy: { sentAt: "desc" },
      skip,
      take,
      select: {
        id: true, direction: true, folder: true,
        fromEmail: true, fromName: true, toEmail: true,
        subject: true, snippet: true, seen: true, sentAt: true,
        aiImportance: true, aiSummary: true,
        leadId: true, ticketId: true, accountId: true,
        tags: { select: { id: true, name: true, color: true } },
        _count: { select: { attachments: true } },
        account: { select: { id: true, label: true, fromEmail: true } },
        lead: { select: { id: true, name: true } },
        ticket: { select: { id: true, title: true } },
      },
    }),
    prisma.inboxEmail.groupBy({
      by: ["folder"],
      where: countScope,
      _count: { _all: true },
    }),
    prisma.inboxEmail.count({ where: { ...countScope, folder: "INBOX", seen: false } }),
    prisma.emailAccount.findMany({
      where: { companyId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, label: true, fromEmail: true, active: true,
        imapHost: true, smtpVerified: true, imapVerified: true,
        lastSyncedAt: true, lastError: true,
      },
    }),
    prisma.inboxEmailTag.findMany({
      where: { companyId },
      select: { id: true, _count: { select: { emails: { where: tagScope } } } },
    }),
    prisma.inboxEmail.count({ where: { ...tagScope, tags: { none: {} } } }),
  ]);

  const counts: Record<string, number> = {};
  for (const f of FOLDERS) counts[f] = 0;
  for (const g of grouped) counts[g.folder] = g._count._all;

  const tagCounts: Record<string, number> = { __none: noTagCount };
  for (const t of tagCountRows) tagCounts[t.id] = t._count.emails;

  return NextResponse.json({
    emails,
    counts,
    unseen,
    accounts: allowed ? accounts.filter((a) => allowed.includes(a.id)) : accounts,
    tagCounts,
  });
}
