import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deliverScheduledMessage } from "@/lib/scheduled-send";

/**
 * GET/POST /api/cron/scheduled-messages
 *
 * Processa a fila de ScheduledMessage (lembretes de reunião do agente IA,
 * futuros follow-ups): envia via Evolution as mensagens PENDING vencidas e
 * persiste na conversa. Roda a cada ~2 min pelo loop do start.sh.
 *
 * Idempotência: marca SENDING antes de enviar (claim atômico via updateMany)
 * — duas execuções simultâneas não duplicam envio.
 */
async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const now = new Date();
  // Lookahead: pega também o que vence nos próximos 60s e AGUARDA o horário
  // exato de cada item — assim sequências com intervalo curto (ex.: 10s) saem
  // espaçadas de verdade, e não todas juntas na mesma rodada de 2 min.
  const LOOKAHEAD_MS = 60_000;
  const WAIT_BUDGET_MS = 75_000; // teto de espera por rodada (curl do cron: 120s)
  const due = await prisma.scheduledMessage.findMany({
    where: { status: "PENDING", sendAt: { lte: new Date(now.getTime() + LOOKAHEAD_MS) } },
    orderBy: { sendAt: "asc" },
    take: 30,
  });

  let sent = 0, failed = 0, skipped = 0;
  const startedAt = Date.now();

  for (const msg of due) {
    const waitMs = msg.sendAt.getTime() - Date.now();
    if (waitMs > 0) {
      // Estourou o orçamento → deixa PENDING pra próxima rodada.
      if (Date.now() - startedAt + waitMs > WAIT_BUDGET_MS) break;
      await new Promise((r) => setTimeout(r, waitMs));
    }
    const r = await deliverScheduledMessage(msg.id);
    if (r === "sent") sent++;
    else if (r === "failed") failed++;
    else skipped++;
  }

  return NextResponse.json({ ok: true, due: due.length, sent, failed, skipped, timestamp: now.toISOString() });
}

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
