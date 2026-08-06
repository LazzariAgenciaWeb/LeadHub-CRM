import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runBlingSync } from "@/lib/bling-sync";

// GET /api/cron/bling-sync
//
// Chamado pelo loop do start.sh (1x/dia). Sincroniza todas as conexões Bling
// ACTIVE (cadastro de clientes + boletos/NF pro financeiro). Protegido por
// CRON_SECRET se a env existir (mesmo padrão dos outros crons).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const bearer = req.headers.get("authorization");
    const legacy = req.headers.get("x-cron-secret");
    const ok = bearer === `Bearer ${secret}` || legacy === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const integrations = await prisma.blingIntegration.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, companyId: true },
  });

  const results: Array<{ companyId: string; ok: boolean; details?: any; error?: string }> = [];
  for (const integ of integrations) {
    try {
      const r = await runBlingSync(integ.companyId);
      results.push({ companyId: integ.companyId, ok: true, details: r });
    } catch (e: any) {
      results.push({ companyId: integ.companyId, ok: false, error: e?.message ?? "erro" });
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    total: integrations.length,
    success: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
