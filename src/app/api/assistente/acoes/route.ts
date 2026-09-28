import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAssistantUser } from "@/lib/personal-assistant/session";
import { confirmPending, cancelPending, getToolContext } from "@/lib/personal-assistant/engine";

/**
 * POST /api/assistente/acoes { op: "confirm" | "cancel" }
 * Botões do cartão de confirmação no app (ação financeira pendente).
 */
export async function POST(req: NextRequest) {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  if (body?.op === "cancel") {
    const r = await cancelPending(auth.userId);
    await prisma.assistantTurn.create({ data: { userId: auth.userId, channel: "APP", role: "assistant", content: r.ok ? r.message : r.error } }).catch(() => {});
    return NextResponse.json(r);
  }
  if (body?.op === "confirm") {
    const ctx = await getToolContext(auth.userId, "APP");
    if (!ctx) return NextResponse.json({ error: "Usuário sem empresa" }, { status: 400 });
    const r = await confirmPending(auth.userId, ctx);
    await prisma.assistantTurn.create({ data: { userId: auth.userId, channel: "APP", role: "assistant", content: r.ok ? r.message : `Erro: ${r.error}` } }).catch(() => {});
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  return NextResponse.json({ error: "op inválido" }, { status: 400 });
}
