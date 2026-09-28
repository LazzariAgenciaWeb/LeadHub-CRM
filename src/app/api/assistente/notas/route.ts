import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAssistantUser } from "@/lib/personal-assistant/session";

/**
 * GET  /api/assistente/notas?kind=&done=1  → bloquinho do usuário
 * POST /api/assistente/notas { kind, title, body?, dueAt? } → cria direto (sem IA)
 */
const KINDS = new Set(["IDEA", "NOTE", "REMINDER", "TASK"]);

export async function GET(req: NextRequest) {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  const kind = req.nextUrl.searchParams.get("kind");
  const includeDone = req.nextUrl.searchParams.get("done") === "1";
  const rows = await prisma.assistantNote.findMany({
    where: { userId: auth.userId, ...(kind && KINDS.has(kind) ? { kind } : {}), ...(includeDone ? {} : { done: false }) },
    orderBy: [{ done: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const kind = KINDS.has(body?.kind) ? body.kind : "NOTE";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "Título obrigatório" }, { status: 400 });
  const dueAt = body?.dueAt ? new Date(body.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) return NextResponse.json({ error: "dueAt inválido" }, { status: 400 });
  const me = await prisma.user.findUnique({ where: { id: auth.userId }, select: { companyId: true } });
  const row = await prisma.assistantNote.create({
    data: { userId: auth.userId, companyId: me?.companyId ?? null, kind, title, body: typeof body?.body === "string" ? body.body.trim() || null : null, dueAt, source: "APP" },
  });
  return NextResponse.json(row, { status: 201 });
}
