import { NextRequest, NextResponse } from "next/server";
import { dispatchDueReminders, sendDailySummaries } from "@/lib/personal-assistant/reminders";

/**
 * GET/POST /api/cron/assistente
 *
 * Assistente pessoal:
 *   - (sempre) dispara lembretes vencidos (AssistantNote) → WhatsApp + push
 *   - (?mode=daily) resumo do dia por usuário, 1x/dia a partir das 8h (fuso do
 *     sistema); idempotente via Setting `assistant_daily_sent:<userId>`.
 *   - (?mode=daily&force=1) reenvia mesmo se já foi hoje (teste).
 *
 * Agendamento: start.sh chama a cada 60s sem mode (lembretes) e a cada 300s
 * com mode=daily. Respeita `Authorization: Bearer <CRON_SECRET>` se existir.
 */
async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const mode = req.nextUrl.searchParams.get("mode");
  const force = req.nextUrl.searchParams.get("force") === "1";
  try {
    const reminders = await dispatchDueReminders();
    const daily = mode === "daily" ? await sendDailySummaries(force) : null;
    return NextResponse.json({ ok: true, reminders, daily });
  } catch (e: any) {
    console.error("[cron/assistente]", e);
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
