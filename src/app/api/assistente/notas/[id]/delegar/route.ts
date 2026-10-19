import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAssistantUser } from "@/lib/personal-assistant/session";
import { delegateToTicket } from "@/lib/personal-assistant/intake";
import { logNoteEvent } from "@/lib/personal-assistant/note-events";
import { appUrl } from "@/lib/assistant-tools/types";

/** POST { assigneeId, instrucoes? } → chamado interno pro responsável; item vira "delegado". */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const me = await prisma.user.findUnique({ where: { id: auth.userId }, select: { companyId: true, name: true, role: true } });
  if (!me?.companyId) return NextResponse.json({ error: "Usuário sem empresa" }, { status: 400 });
  const note = await prisma.assistantNote.findFirst({ where: { id, userId: auth.userId }, select: { id: true, title: true, body: true, dueAt: true } });
  if (!note) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  const assignee = await prisma.user.findFirst({ where: { id: String(body?.assigneeId ?? ""), companyId: me.companyId }, select: { id: true, name: true } });
  if (!assignee) return NextResponse.json({ error: "Responsável inválido" }, { status: 400 });

  const ticketId = await delegateToTicket({ companyId: me.companyId, userId: auth.userId, userName: me.name, role: me.role }, { title: note.title, body: note.body, dueAt: note.dueAt, instructions: typeof body?.instrucoes === "string" ? body.instrucoes : null }, assignee.id);
  const doneNote = `Delegado para ${assignee.name} — chamado ${appUrl(`/chamados/${ticketId}`)}`;
  await prisma.assistantNote.update({ where: { id }, data: { done: true, doneAt: new Date(), doneNote, important: false, urgent: true } });
  await logNoteEvent(id, "DONE", "APP", doneNote);
  return NextResponse.json({ ok: true, ticketId, assignee: assignee.name, url: appUrl(`/chamados/${ticketId}`) });
}
