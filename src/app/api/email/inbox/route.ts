import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import type { InboxEmailFolder, Prisma } from "@/generated/prisma";

const FOLDERS: InboxEmailFolder[] = ["INBOX", "IMPORTANT", "SENT", "SPAM", "TRASH"];

// GET /api/email/inbox?folder=INBOX&q=&skip=&take=&leadId=&ticketId=
// Lista emails da caixa da empresa + contadores por pasta.
// Com leadId/ticketId, ignora pasta e lista o histórico do vínculo (lixeira fora).
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const sp = req.nextUrl.searchParams;
  const role = (session.user as any).role as string;
  const companyId = role === "SUPER_ADMIN"
    ? (sp.get("companyId") ?? (session.user as any).companyId)
    : (session.user as any).companyId;
  if (!companyId) return NextResponse.json({ emails: [], counts: {}, unseen: 0 });

  const leadId = sp.get("leadId");
  const ticketId = sp.get("ticketId");
  const q = sp.get("q")?.trim();
  const skip = Math.max(0, parseInt(sp.get("skip") ?? "0", 10) || 0);
  const take = Math.min(100, Math.max(1, parseInt(sp.get("take") ?? "50", 10) || 50));

  const folderParam = (sp.get("folder") ?? "INBOX").toUpperCase() as InboxEmailFolder;
  const folder = FOLDERS.includes(folderParam) ? folderParam : "INBOX";

  const where: Prisma.InboxEmailWhereInput = { companyId };
  if (leadId || ticketId) {
    if (leadId) where.leadId = leadId;
    if (ticketId) where.ticketId = ticketId;
    where.folder = { not: "TRASH" };
  } else {
    where.folder = folder;
  }
  if (q) {
    where.OR = [
      { subject: { contains: q, mode: "insensitive" } },
      { fromEmail: { contains: q, mode: "insensitive" } },
      { fromName: { contains: q, mode: "insensitive" } },
      { toEmail: { contains: q, mode: "insensitive" } },
      { snippet: { contains: q, mode: "insensitive" } },
    ];
  }

  const [emails, grouped, unseen, config] = await Promise.all([
    prisma.inboxEmail.findMany({
      where,
      orderBy: { sentAt: "desc" },
      skip,
      take,
      select: {
        id: true, direction: true, folder: true,
        fromEmail: true, fromName: true, toEmail: true,
        subject: true, snippet: true, seen: true, sentAt: true,
        leadId: true, ticketId: true,
        lead: { select: { id: true, name: true } },
        ticket: { select: { id: true, title: true } },
      },
    }),
    prisma.inboxEmail.groupBy({
      by: ["folder"],
      where: { companyId },
      _count: { _all: true },
    }),
    prisma.inboxEmail.count({ where: { companyId, folder: "INBOX", seen: false } }),
    prisma.companyImapConfig.findUnique({
      where: { companyId },
      select: { active: true, verified: true, lastSyncedAt: true, lastError: true },
    }),
  ]);

  const counts: Record<string, number> = {};
  for (const f of FOLDERS) counts[f] = 0;
  for (const g of grouped) counts[g.folder] = g._count._all;

  return NextResponse.json({ emails, counts, unseen, config });
}
