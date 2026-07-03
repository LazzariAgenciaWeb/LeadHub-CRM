/**
 * Reprocessa eventos do Meta Conversions API que ficaram PENDING/FAILED
 * (falha de rede, erro transitório do Meta). Chamado periodicamente pelo
 * start.sh (mesmo padrão dos outros crons).
 *
 * Segurança: aceita `Authorization: Bearer <CRON_SECRET>` se a env existir;
 * sem CRON_SECRET, aceita qualquer chamada (dev).
 */
import { NextRequest, NextResponse } from "next/server";
import { retryPendingConversions } from "@/lib/meta-capi";

const MAX_PER_TICK = 50;

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
  }

  try {
    const summary = await retryPendingConversions(MAX_PER_TICK);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err: any) {
    console.error("[meta-capi-retry] crash:", err?.message ?? err);
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
