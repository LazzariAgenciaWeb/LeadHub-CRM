import { NextRequest, NextResponse } from "next/server";
import { autoCloseExpired } from "@/lib/ticket-confirm";

/**
 * GET/POST /api/cron/chamados-confirmacao
 *
 * Fecha sozinho o chamado resolvido que o cliente não confirmou no prazo
 * (3 dias úteis — lib/ticket-confirm). Roda a cada 15 min (start.sh).
 */
async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const closed = await autoCloseExpired();
  return NextResponse.json({ ok: true, closed });
}

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
