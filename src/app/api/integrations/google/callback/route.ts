import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import {
  exchangeCodeForTokens,
  decodeIdToken,
  detectAuthorizedServices,
  tokenCrypto,
  type GoogleService,
} from "@/lib/google-oauth";

// Mapeia serviço autorizado → IntegrationProvider do schema
const SERVICE_TO_PROVIDER: Record<GoogleService, "GA4" | "SEARCH_CONSOLE" | "BUSINESS_PROFILE"> = {
  ga4: "GA4",
  sc: "SEARCH_CONSOLE",
  gbp: "BUSINESS_PROFILE",
};

// GET /api/integrations/google/callback?code=...&state=...
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // Usuário cancelou ou Google retornou erro
  if (error) {
    return redirectToCompany(null, `?integration_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return redirectToCompany(null, "?integration_error=missing_params");
  }

  // Decodifica state
  let payload: { s: string; c: string; sv: GoogleService[] };
  try {
    payload = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch {
    return redirectToCompany(null, "?integration_error=invalid_state");
  }

  // CSRF: confere com o cookie
  const cookieStore = await cookies();
  const cookieState = cookieStore.get("lh_oauth_state")?.value;
  if (!cookieState || cookieState !== payload.s) {
    return redirectToCompany(payload.c, "?integration_error=state_mismatch");
  }
  // Limpa o cookie de state
  cookieStore.delete("lh_oauth_state");

  // Reconfere permissão (importante: o usuário pode ter perdido acesso entre connect e callback)
  const auth = await authorizeVaultAccess(payload.c);
  if (!auth.ok || !auth.canWrite) {
    return redirectToCompany(payload.c, "?integration_error=forbidden");
  }

  // Troca code por tokens
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (e: any) {
    console.error("[google-oauth] exchange failed:", e.message);
    return redirectToCompany(payload.c, `?integration_error=${encodeURIComponent("token_exchange_failed")}`);
  }

  // Detecta quais escopos foram efetivamente concedidos
  const grantedServices = detectAuthorizedServices(tokens.scope);
  if (grantedServices.length === 0) {
    return redirectToCompany(payload.c, "?integration_error=no_scopes_granted");
  }

  // Identifica o usuário Google que autorizou
  const idInfo = decodeIdToken(tokens.id_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  // Cria/atualiza um MarketingIntegration por serviço autorizado.
  // Refresh token só vem na PRIMEIRA autorização — preservamos o anterior em re-conexões.
  for (const service of grantedServices) {
    const provider = SERVICE_TO_PROVIDER[service];
    if (!provider) continue;

    const data: any = {
      companyId: payload.c,
      provider,
      accountId: null, // ainda não escolheu propriedade — fluxo seguinte
      accessTokenEnc: tokenCrypto.encrypt(tokens.access_token),
      tokenExpiresAt: expiresAt,
      scopes: tokens.scope.split(/\s+/).filter(Boolean),
      googleEmail: idInfo.email ?? null,
      googleName: idInfo.name ?? null,
      status: "ACTIVE" as const,
      lastError: null,
      createdById: auth.userId,
    };
    if (tokens.refresh_token) {
      data.refreshTokenEnc = tokenCrypto.encrypt(tokens.refresh_token);
    }

    // Upsert por (companyId, provider, accountId=null) — mantém um registro "raiz" antes de
    // o usuário escolher a propriedade. Quando ele escolhe, gravamos o accountId.
    const existing = await prisma.marketingIntegration.findFirst({
      where: { companyId: payload.c, provider, accountId: null },
    });
    if (existing) {
      const updateData: any = { ...data };
      // se não veio refresh_token novo, preserva o antigo
      if (!tokens.refresh_token) delete updateData.refreshTokenEnc;
      delete updateData.companyId;
      delete updateData.provider;
      delete updateData.createdById;
      await prisma.marketingIntegration.update({ where: { id: existing.id }, data: updateData });
    } else {
      await prisma.marketingIntegration.create({ data });
    }
  }

  return redirectToCompany(payload.c, "?integration_success=1");
}

function redirectToCompany(companyId: string | null, qs: string): NextResponse {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const path = companyId ? `/empresas/${companyId}` : "/empresas";
  return NextResponse.redirect(`${base.replace(/\/$/, "")}${path}${qs}`);
}
