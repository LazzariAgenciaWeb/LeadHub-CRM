import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/backfill-conversation-notes
 * Body: { apply?: boolean }
 *
 * Copia ConversationNote existentes que ainda não estão no Lead.notes
 * legado (campo que o chat do WhatsApp parseia). Antes do commit b17c883
 * notas criadas via API ficavam invisíveis no chat.
 *
 * Idempotente: detecta entries já presentes pelo body e pula.
 *
 * Acesso: apenas SUPER_ADMIN.
 */

function pad2(n: number) { return String(n).padStart(2, "0"); }
function fmtStamp(d: Date) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${pad2(d.getFullYear() % 100)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session || role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Apenas SUPER_ADMIN" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const apply = !!body.apply;

  const notes = await prisma.conversationNote.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, conversationId: true, body: true, authorName: true, createdAt: true, type: true },
  });

  const conversationIds = [...new Set(notes.map((n) => n.conversationId))];
  const leads = await prisma.lead.findMany({
    where: { conversationId: { in: conversationIds } },
    select: { id: true, conversationId: true, notes: true },
  });
  const leadByConv = new Map(leads.map((l) => [l.conversationId, l]));

  let alreadyIn = 0, missingLead = 0, scheduled = 0, toBackfill = 0;
  const updates = new Map<string, { current: string; count: number }>();

  for (const n of notes) {
    // SCHEDULED já são appendadas pelo leads PATCH com "📅 ..." — pulamos.
    if (n.type === "SCHEDULED") { scheduled++; continue; }

    const lead = leadByConv.get(n.conversationId);
    if (!lead) { missingLead++; continue; }

    const body = n.body.trim();
    const author = (n.authorName ?? "Usuário").trim();
    const current = updates.get(lead.id)?.current ?? lead.notes ?? "";
    if (current.includes(body)) { alreadyIn++; continue; }

    const stamp = fmtStamp(n.createdAt);
    const entry = `[${stamp}] ${body} — ${author}`;
    const next = current ? `${entry}\n\n${current}` : entry;
    updates.set(lead.id, { current: next, count: (updates.get(lead.id)?.count ?? 0) + 1 });
    toBackfill++;
  }

  const summary = {
    totalNotes: notes.length,
    skippedScheduled: scheduled,
    skippedMissingLead: missingLead,
    skippedAlreadyIn: alreadyIn,
    toBackfill,
    leadsAffected: updates.size,
  };

  if (!apply) {
    return NextResponse.json({ dryRun: true, ...summary });
  }

  let applied = 0;
  for (const [leadId, { current }] of updates) {
    await prisma.lead.update({ where: { id: leadId }, data: { notes: current } });
    applied++;
  }

  return NextResponse.json({ applied: true, ...summary, leadsUpdated: applied });
}
