/**
 * Worker das respostas com IA a comentários do Instagram: analisa a fila
 * (classifica + escreve no tom do dono) e publica o que está agendado, no
 * ritmo humano e com teto por hora. Chamado pelo start.sh a cada ~60s.
 *
 * Segurança: aceita `Authorization: Bearer <CRON_SECRET>` se a env existir;
 * sem CRON_SECRET, aceita qualquer chamada (dev).
 */
import { NextRequest, NextResponse } from "next/server";
import { processAiReplyQueue } from "@/lib/instagram-ai-replies";

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const summary = await processAiReplyQueue();
  return NextResponse.json({ ok: true, ...summary });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
