import { NextRequest, NextResponse } from "next/server";
import { runFollowUpSweep, runFollowThroughSweep } from "@/lib/auto-agent";

/**
 * GET/POST /api/cron/agent-revival
 *
 * Follow-up de conversa parada: varre as conversas em que NÓS falamos por
 * último e o contato sumiu, e manda a próxima etapa da sequência configurada
 * no agente (Assistant.followUpSteps; o resgate antigo vira a etapa 1).
 *
 * Varredura em vez de timer de propósito: sobrevive a restart de deploy e
 * alcança conversas que pararam antes da opção existir. Roda a cada ~5 min
 * pelo loop do start.sh; os limites (etapas, horário de atendimento, teto por
 * rodada) vivem no motor.
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
    // Duas varreduras irmãs, por quem está devendo a mensagem:
    //  - continuação: NÓS prometemos e não entregamos → entrega o que faltou;
    //  - follow-up: o CONTATO sumiu depois da nossa resposta → próxima etapa.
    // A continuação vem primeiro: cumprir a promessa muda a última mensagem da
    // conversa e tira do follow-up um caso que não era abandono, era falha nossa.
    const follow = await runFollowThroughSweep();
    const { checked, sent, exhausted } = await runFollowUpSweep();
    return NextResponse.json({
      ok: true,
      checked,
      sent,
      exhausted,
      continuacao: follow,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[Cron Resgate] falhou:", err);
    return NextResponse.json({ ok: false, error: err?.message ?? "erro" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
