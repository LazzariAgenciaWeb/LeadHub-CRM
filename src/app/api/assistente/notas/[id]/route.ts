import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAssistantUser } from "@/lib/personal-assistant/session";
import { parseTags } from "@/lib/personal-assistant/tags";
import { logNoteEvent, describeEdit } from "@/lib/personal-assistant/note-events";

/** PATCH { done?, title?, body?, dueAt? } · DELETE — item do bloquinho. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const existing = await prisma.assistantNote.findFirst({ where: { id, userId: auth.userId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const data: any = {};
  if (typeof body?.done === "boolean") {
    data.done = body.done; data.doneAt = body.done ? new Date() : null;
    if (body.done && typeof body?.doneNote === "string") data.doneNote = body.doneNote.trim() || null;
  }
  if (typeof body?.title === "string" && body.title.trim()) data.title = body.title.trim();
  if (typeof body?.kind === "string" && ["IDEA", "NOTE", "REMINDER", "TASK"].includes(body.kind)) data.kind = body.kind;
  if (body?.tags !== undefined) data.tags = parseTags(body.tags);
  if (body?.body !== undefined) data.body = typeof body.body === "string" ? body.body.trim() || null : null;
  if (body?.dueAt !== undefined) {
    if (body.dueAt === null || body.dueAt === "") data.dueAt = null;
    else { const d = new Date(body.dueAt); if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "dueAt inválido" }, { status: 400 }); data.dueAt = d; data.remindedAt = null; }
  }
  const row = await prisma.assistantNote.update({ where: { id }, data });
  if (data.done === true) await logNoteEvent(id, "DONE", "APP", data.doneNote ?? null);
  else if (data.done === false) await logNoteEvent(id, "REOPENED", "APP");
  else await logNoteEvent(id, "EDITED", "APP", describeEdit(data));
  return NextResponse.json(row);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const n = await prisma.assistantNote.deleteMany({ where: { id, userId: auth.userId } });
  if (!n.count) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
