import { NextRequest, NextResponse } from "next/server";
import { runCrmAiStageSweep } from "@/lib/lead-stage-ai";

/**
 * GET/POST /api/cron/crm-ai-stage
 *
 * Varredura da IA que lê as conversas do WhatsApp e sugere (ou aplica, no modo
 * automático) a etapa do funil dos leads/oportunidades. Só roda pra empresas
 * que ligaram em Configurações → CRM / Pipeline. Loop no start.sh (~5 min).
 */
async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const r = await runCrmAiStageSweep();
    return NextResponse.json({ ok: true, ...r, timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error("[Cron CRM IA etapa]", err);
    return NextResponse.json({ ok: false, error: err?.message ?? "erro" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
