import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { blockClientPortalWrite } from "@/lib/client-portal";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { assertModule } from "@/lib/billing";
import { syncGA4 } from "@/lib/google/ga4-sync";
import { syncSearchConsole } from "@/lib/google/search-console-sync";
import { syncGbp } from "@/lib/google/gbp-sync";

// POST /api/companies/[id]/marketing/sync?provider=ga4|sc|gbp|all&force=1
//
// Dispara sync sob demanda (botão "Atualizar agora" na UI). Por padrão
// respeita um throttle de 2h pra não estourar cota das APIs do Google
// quando o usuário fica abrindo a tela. ?force=1 ignora o throttle.

const THROTTLE_MS = 2 * 60 * 60 * 1000; // 2 horas

type Provider = "GA4" | "SEARCH_CONSOLE" | "BUSINESS_PROFILE";

const PROVIDER_PARAM_MAP: Record<string, Provider[]> = {
  ga4: ["GA4"],
  sc: ["SEARCH_CONSOLE"],
  gbp: ["BUSINESS_PROFILE"],
  all: ["GA4", "SEARCH_CONSOLE", "BUSINESS_PROFILE"],
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params;

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "marketing");
  if (!gate.ok) return gate.response;

  // Portal do cliente é somente leitura — não dispara sync.
  const blocked = await blockClientPortalWrite(session);
  if (blocked) return blocked;

  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const providerParam = (url.searchParams.get("provider") || "all").toLowerCase();
  const force = url.searchParams.get("force") === "1";

  const providers = PROVIDER_PARAM_MAP[providerParam];
  if (!providers) {
    return NextResponse.json({ error: "provider inválido (use: ga4|sc|gbp|all)" }, { status: 400 });
  }

  const integrations = await prisma.marketingIntegration.findMany({
    where: {
      companyId,
      status: "ACTIVE",
      accountId: { not: null },
      provider: { in: providers },
    },
    select: { id: true, provider: true, lastSyncAt: true, accountLabel: true },
  });

  const results: Array<{
    id: string;
    provider: string;
    ok: boolean;
    skipped?: boolean;
    details?: unknown;
    error?: string;
  }> = [];

  for (const integ of integrations) {
    // Throttle 2h — só usuário com ?force=1 ignora
    if (!force && integ.lastSyncAt) {
      const since = Date.now() - integ.lastSyncAt.getTime();
      if (since < THROTTLE_MS) {
        results.push({ id: integ.id, provider: integ.provider, ok: true, skipped: true });
        continue;
      }
    }

    try {
      let detail: unknown;
      if (integ.provider === "GA4") detail = await syncGA4(integ.id);
      else if (integ.provider === "SEARCH_CONSOLE") detail = await syncSearchConsole(integ.id);
      else if (integ.provider === "BUSINESS_PROFILE") detail = await syncGbp(integ.id);
      results.push({ id: integ.id, provider: integ.provider, ok: true, details: detail });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "erro desconhecido";
      results.push({ id: integ.id, provider: integ.provider, ok: false, error: msg });
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    total: integrations.length,
    success: results.filter((r) => r.ok && !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
