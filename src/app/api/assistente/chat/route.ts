import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAssistantUser } from "@/lib/personal-assistant/session";
import { runPersonalAssistant } from "@/lib/personal-assistant/engine";

/**
 * POST /api/assistente/chat  { text }
 * Porta "app" do assistente pessoal. Devolve resposta + ações executadas +
 * ação pendente de confirmação (se houver).
 *
 * GET /api/assistente/chat → histórico recente do canal APP (pra reabrir o chat).
 */
export async function POST(req: NextRequest) {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });
  if (text.length > 4000) return NextResponse.json({ error: "Mensagem muito longa" }, { status: 400 });

  const result = await runPersonalAssistant({ userId: auth.userId, channel: "APP", text });
  if (!result.ok) return NextResponse.json({ error: result.error, actions: result.actions }, { status: 502 });
  return NextResponse.json(result);
}

export async function GET() {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  const since = new Date(Date.now() - 24 * 3600_000);
  const rows = await prisma.assistantTurn.findMany({
    where: { userId: auth.userId, channel: "APP", createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    take: 40,
    select: { role: true, content: true, createdAt: true },
  });
  const pending = await prisma.assistantPendingAction.findFirst({
    where: { userId: auth.userId, status: "PENDING", expiresAt: { gt: new Date() } },
    select: { id: true, summary: true },
  });
  return NextResponse.json({ history: rows, pending });
}
