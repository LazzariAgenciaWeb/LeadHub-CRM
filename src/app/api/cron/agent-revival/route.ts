import { NextRequest, NextResponse } from "next/server";
import { runRevivalSweep } from "@/lib/auto-agent";

/**
 * GET/POST /api/cron/agent-revival
 *
 * Resgate de conversa parada: varre as conversas em que NÓS falamos por último
 * e o contato sumiu, e manda uma única mensagem de retomada (config por agente
 * em Assistant.revivalDelayMin / revivalText; 0 = desligado).
 *
 * Varredura em vez de timer de propósito: sobrevive a restart de deploy e
 * alcança conversas que pararam antes da opção existir. Roda a cada ~5 min
 * pelo loop do start.sh; os limites (1 por episódio de silêncio, horário de
 * atendimento, teto por rodada) vivem no motor.
 */
async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const { checked, sent } = await runRevivalSweep();
    return NextResponse.json({ ok: true, checked, sent, timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error("[Cron Resgate] falhou:", err);
    return NextResponse.json({ ok: false, error: err?.message ?? "erro" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
