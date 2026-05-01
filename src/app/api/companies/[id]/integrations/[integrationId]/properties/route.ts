import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { googleFetch } from "@/lib/google/token";

/**
 * GET /api/companies/[id]/integrations/[integrationId]/properties
 *
 * Lista as "contas" disponíveis na conexão Google, conforme o provider:
 *   - GA4 → properties (Analytics Admin API)
 *   - SEARCH_CONSOLE → sites (webmasters API)
 *   - BUSINESS_PROFILE → locations (Business Profile — pode falhar se app não aprovado)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; integrationId: string }> }
) {
  const { id: companyId, integrationId } = await params;
  const auth = await authorizeVaultAccess(companyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const integ = await prisma.marketingIntegration.findUnique({
    where: { id: integrationId },
    select: { companyId: true, provider: true },
  });
  if (!integ || integ.companyId !== companyId) {
    return NextResponse.json({ error: "Integração não encontrada" }, { status: 404 });
  }

  try {
    if (integ.provider === "GA4") {
      // Analytics Admin API: lista accountSummaries (contas + propriedades)
      const r = await googleFetch(
        integrationId,
        "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200"
      );
      if (!r.ok) {
        const txt = await r.text();
        return NextResponse.json({ error: `Google API: ${r.status} ${txt}` }, { status: 502 });
      }
      const data = await r.json();
      // Achata: cada propriedade vira um item { id, label, accountName }
      const properties: { id: string; label: string; group?: string }[] = [];
      for (const acc of data.accountSummaries ?? []) {
        for (const prop of acc.propertySummaries ?? []) {
          properties.push({
            id: prop.property,                 // ex: "properties/123456789"
            label: prop.displayName,           // ex: "azz.com.br - GA4"
            group: acc.displayName,            // ex: "AZZ Agência"
          });
        }
      }
      return NextResponse.json({ items: properties });
    }

    if (integ.provider === "SEARCH_CONSOLE") {
      // Webmasters API: lista sites verificados
      const r = await googleFetch(
        integrationId,
        "https://www.googleapis.com/webmasters/v3/sites"
      );
      if (!r.ok) {
        const txt = await r.text();
        return NextResponse.json({ error: `Google API: ${r.status} ${txt}` }, { status: 502 });
      }
      const data = await r.json();
      const items = (data.siteEntry ?? [])
        .filter((s: any) => s.permissionLevel !== "siteUnverifiedUser")
        .map((s: any) => ({
          id: s.siteUrl,             // ex: "sc-domain:azz.com.br" ou "https://azz.com.br/"
          label: s.siteUrl,
          group: s.permissionLevel,  // siteOwner, siteFullUser…
        }));
      return NextResponse.json({ items });
    }

    if (integ.provider === "BUSINESS_PROFILE") {
      // GBP: lista accounts → cada conta tem locations
      const accR = await googleFetch(
        integrationId,
        "https://mybusinessaccountmanagement.googleapis.com/v1/accounts"
      );
      if (!accR.ok) {
        const txt = await accR.text();
        return NextResponse.json(
          { error: `Google Business Profile: ${accR.status} ${txt}`, hint: "App pode não estar aprovado pelo Google ainda." },
          { status: 502 }
        );
      }
      const accData = await accR.json();
      const items: { id: string; label: string; group?: string }[] = [];
      for (const acc of accData.accounts ?? []) {
        // Lista locations dessa conta
        const locR = await googleFetch(
          integrationId,
          `https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations?readMask=name,title,storefrontAddress`
        );
        if (!locR.ok) continue;
        const locData = await locR.json();
        for (const loc of locData.locations ?? []) {
          items.push({
            id: loc.name,                              // ex: "locations/1234567890"
            label: loc.title || loc.name,
            group: acc.accountName || acc.name,
          });
        }
      }
      return NextResponse.json({ items });
    }

    return NextResponse.json({ error: "Provider sem listagem implementada" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
