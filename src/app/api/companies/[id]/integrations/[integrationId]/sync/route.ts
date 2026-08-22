import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { syncGA4 } from "@/lib/google/ga4-sync";
import { syncSearchConsole } from "@/lib/google/search-console-sync";
import { syncGbp } from "@/lib/google/gbp-sync";
import { syncGoogleAds } from "@/lib/google/google-ads-sync";
import { syncMetaAds } from "@/lib/meta/meta-ads";

// POST /api/companies/[id]/integrations/[integrationId]/sync
// Dispara um sync manual ("sincronizar agora").
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; integrationId: string }> }
) {
  const { id: companyId, integrationId } = await params;
  // checkCofreModule: false — sync de integração Marketing não exige Cofre.
  // O gate de plano correto é "marketing" (a integração já vive sob este módulo).
  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const integ = await prisma.marketingIntegration.findUnique({
    where: { id: integrationId },
    select: { companyId: true, provider: true, accountId: true, status: true },
  });
  if (!integ || integ.companyId !== companyId) {
    return NextResponse.json({ error: "Integração não encontrada" }, { status: 404 });
  }
  if (!integ.accountId) {
    return NextResponse.json({ error: "Selecione a propriedade/site/perfil antes de sincronizar" }, { status: 400 });
  }
  if (integ.status === "DISCONNECTED") {
    return NextResponse.json({ error: "Integração desconectada" }, { status: 400 });
  }

  try {
    let result: any;
    if (integ.provider === "GA4") {
      result = await syncGA4(integrationId);
    } else if (integ.provider === "SEARCH_CONSOLE") {
      result = await syncSearchConsole(integrationId);
    } else if (integ.provider === "BUSINESS_PROFILE") {
      result = await syncGbp(integrationId);
    } else if (integ.provider === "GOOGLE_ADS") {
      result = await syncGoogleAds(integrationId);
    } else if (integ.provider === "META_ADS") {
      result = await syncMetaAds(integrationId);
    } else {
      return NextResponse.json({ error: `Sync de ${integ.provider} não implementado` }, { status: 400 });
    }
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Falha no sync" }, { status: 500 });
  }
}
