import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncGA4 } from "@/lib/google/ga4-sync";
import { syncSearchConsole } from "@/lib/google/search-console-sync";
import { syncGbp } from "@/lib/google/gbp-sync";

// GET /api/cron/marketing-sync
//
// Endpoint chamado pelo loop em start.sh (1x/dia) pra sincronizar todas as
// integrações ACTIVE que tenham accountId definido. Protegido por CRON_SECRET
// se a env existir (mesmo padrão dos outros crons).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    // Aceita ambos formatos pra alinhar com os outros crons:
    //   Authorization: Bearer <secret>     (padrão dos outros endpoints)
    //   x-cron-secret: <secret>            (legado deste handler)
    const bearer = req.headers.get("authorization");
    const legacy = req.headers.get("x-cron-secret");
    const ok = bearer === `Bearer ${secret}` || legacy === secret;
    if (!ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const integrations = await prisma.marketingIntegration.findMany({
    where: {
      status: "ACTIVE",
      accountId: { not: null },
      provider: { in: ["GA4", "SEARCH_CONSOLE", "BUSINESS_PROFILE"] },
    },
    select: { id: true, companyId: true, provider: true, accountLabel: true },
  });

  const results: Array<{ id: string; provider: string; ok: boolean; details?: any; error?: string }> = [];

  for (const integ of integrations) {
    try {
      let r: any;
      if (integ.provider === "GA4") r = await syncGA4(integ.id);
      else if (integ.provider === "SEARCH_CONSOLE") r = await syncSearchConsole(integ.id);
      else if (integ.provider === "BUSINESS_PROFILE") r = await syncGbp(integ.id);
      results.push({ id: integ.id, provider: integ.provider, ok: true, details: r });
    } catch (e: any) {
      results.push({ id: integ.id, provider: integ.provider, ok: false, error: e.message ?? "erro" });
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
