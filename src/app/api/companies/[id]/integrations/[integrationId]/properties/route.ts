import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { googleFetch } from "@/lib/google/token";
import { listGoogleAdsAccounts } from "@/lib/google/google-ads-sync";
import { listMetaAdAccounts } from "@/lib/meta/meta-ads";
import { assertModule } from "@/lib/billing";

/**
 * GET /api/companies/[id]/integrations/[integrationId]/properties
 *
 * Lista as "contas" disponíveis na conexão Google, conforme o provider:
 *   - GA4 → properties (Analytics Admin API)
 *   - SEARCH_CONSOLE → sites (webmasters API)
 *   - BUSINESS_PROFILE → locations (Business Profile — pode falhar se app não aprovado)
 *   - GOOGLE_ADS → contas-cliente (expande MCC)
 *   - META_ADS → contas de anúncio (diretas + as do Business Manager)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; integrationId: string }> }
) {
  const { id: companyId, integrationId } = await params;

  // fix A3 — gate de módulo marketing
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "marketing");
  if (!gate.ok) return gate.response;

  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const integ = await prisma.marketingIntegration.findUnique({
    where: { id: integrationId },
    select: { companyId: true, provider: true, googleEmail: true },
  });
  if (!integ || integ.companyId !== companyId) {
    return NextResponse.json({ error: "Integração não encontrada" }, { status: 404 });
  }

  try {
    if (integ.provider === "GA4") {
      // Analytics Admin API: lista accountSummaries (contas + propriedades).
      // pageSize máximo é 200 — conta de agência passa disso, então seguimos o
      // nextPageToken (mesmo motivo do GBP: lista truncada engana).
      const properties: { id: string; label: string; group?: string }[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 20; page++) {
        const u = new URL("https://analyticsadmin.googleapis.com/v1beta/accountSummaries");
        u.searchParams.set("pageSize", "200");
        if (pageToken) u.searchParams.set("pageToken", pageToken);
        const r = await googleFetch(integrationId, u.toString());
        if (!r.ok) {
          const txt = await r.text();
          return NextResponse.json({ error: `Google API: ${r.status} ${txt}` }, { status: 502 });
        }
        const data = await r.json();
        // Achata: cada propriedade vira um item { id, label, accountName }
        for (const acc of data.accountSummaries ?? []) {
          for (const prop of acc.propertySummaries ?? []) {
            properties.push({
              id: prop.property,                 // ex: "properties/123456789"
              label: prop.displayName,           // ex: "azz.com.br - GA4"
              group: acc.displayName,            // ex: "AZZ Agência"
            });
          }
        }
        pageToken = data.nextPageToken;
        if (!pageToken) break;
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
      // GBP: lista accounts → cada conta tem locations.
      //
      // As duas APIs paginam com defaults BAIXOS: accounts.list traz 20 por
      // página e accounts.locations.list traz 10 (!). Sem seguir o
      // nextPageToken, uma conta de agência com 27 perfis mostrava só 10 —
      // e ninguém desconfiava, porque a lista vinha "cheia".
      const accounts: any[] = [];
      let accToken: string | undefined;
      for (let page = 0; page < 20; page++) {
        const u = new URL("https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
        u.searchParams.set("pageSize", "20"); // máximo permitido pela API
        if (accToken) u.searchParams.set("pageToken", accToken);
        const accR = await googleFetch(integrationId, u.toString());
        if (!accR.ok) {
          const txt = await accR.text();
          return NextResponse.json(
            {
              error: `Google Business Profile: ${accR.status} ${txt}`,
              hint: accR.status === 403
                ? "403 costuma ser conta Google sem acesso a nenhum perfil, ou cota da Business Profile API não liberada pro projeto."
                : "App pode não estar aprovado pelo Google ainda.",
            },
            { status: 502 }
          );
        }
        const accData = await accR.json();
        accounts.push(...(accData.accounts ?? []));
        accToken = accData.nextPageToken;
        if (!accToken) break;
      }

      const items: { id: string; label: string; group?: string }[] = [];
      // Falha ao listar os perfis de UMA conta não pode sumir em silêncio: era
      // isso que fazia o modal abrir vazio, sem dizer o porquê.
      const problems: string[] = [];
      for (const acc of accounts) {
        let locToken: string | undefined;
        for (let page = 0; page < 50; page++) {
          const u = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations`);
          u.searchParams.set("readMask", "name,title,storefrontAddress");
          u.searchParams.set("pageSize", "100"); // máximo permitido pela API
          if (locToken) u.searchParams.set("pageToken", locToken);
          const locR = await googleFetch(integrationId, u.toString());
          if (!locR.ok) {
            const txt = (await locR.text()).slice(0, 300);
            problems.push(`${acc.accountName || acc.name}: ${locR.status} ${txt}`);
            break;
          }
          const locData = await locR.json();
          for (const loc of locData.locations ?? []) {
            items.push({
              id: loc.name,                              // ex: "locations/1234567890"
              label: loc.title || loc.name,
              group: acc.accountName || acc.name,
            });
          }
          locToken = locData.nextPageToken;
          if (!locToken) break;
        }
      }

      if (items.length === 0) {
        // Sem nenhum perfil: dizer o motivo provável em vez de "lista vazia".
        return NextResponse.json(
          {
            items: [],
            error: problems.length > 0
              ? `Nenhum perfil retornado. A Google recusou a listagem:\n${problems.join("\n")}`
              : `A conta Google conectada${integ.googleEmail ? ` (${integ.googleEmail})` : ""} não administra nenhum perfil do Meu Negócio.`,
            hint: problems.length > 0
              ? "Se aparecer PERMISSION_DENIED, essa conta Google não tem papel no grupo de perfis. Se for RESOURCE_EXHAUSTED, é cota da Business Profile API — tente de novo em alguns minutos."
              : "No Gerenciador de Perfis (business.google.com), confirme que ESTE e-mail está como Proprietário ou Administrador do perfil. Acesso via outro e-mail da empresa não vale — a API só enxerga o e-mail que autorizou.",
          },
          { status: problems.length > 0 ? 502 : 200 }
        );
      }

      // Achou perfis, mas alguma conta falhou → devolve o que deu e avisa.
      return NextResponse.json({
        items,
        ...(problems.length > 0
          ? { warning: `Algumas contas não puderam ser listadas:\n${problems.join("\n")}` }
          : {}),
      });
    }

    if (integ.provider === "GOOGLE_ADS") {
      // Lista contas-cliente acessíveis (expande MCC). id = só dígitos do customer.
      const accounts = await listGoogleAdsAccounts(integrationId);
      const items = accounts.map((a) => ({
        id: a.id,
        label: a.currency ? `${a.label} (${a.currency})` : a.label,
        group: a.group,
      }));
      return NextResponse.json({ items });
    }

    if (integ.provider === "META_ADS") {
      // Contas de anúncio da Meta. id = "act_<account_id>".
      const accounts = await listMetaAdAccounts(integrationId);
      const items = accounts.map((a) => ({
        id: a.id,
        label: a.currency ? `${a.label} (${a.currency})` : a.label,
        group: a.group,
      }));
      if (items.length === 0) {
        return NextResponse.json(
          {
            error: "Nenhuma conta de anúncios visível para este login do Meta.",
            hint: "Confirme que a permissão ads_read foi concedida e que o usuário tem acesso à conta no Gerenciador de Negócios. Sem Acesso Avançado aprovado, só contas de quem tem papel no app aparecem.",
          },
          { status: 502 }
        );
      }
      return NextResponse.json({ items });
    }

    return NextResponse.json({ error: "Provider sem listagem implementada" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
