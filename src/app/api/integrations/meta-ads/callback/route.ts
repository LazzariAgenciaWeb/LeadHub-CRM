import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import {
  metaAdsExchangeCode,
  metaAdsMe,
  metaAdsGrantedScopes,
  metaTokenCrypto,
} from "@/lib/meta/meta-ads";

// GET /api/integrations/meta-ads/callback?code=...&state=...
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error_description") || url.searchParams.get("error");

  if (error) return redirectToCompany(null, `?integration_error=${encodeURIComponent(error)}`);
  if (!code || !state) return redirectToCompany(null, "?integration_error=missing_params");

  let payload: { s: string; c: string };
  try {
    payload = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch {
    return redirectToCompany(null, "?integration_error=invalid_state");
  }

  // CSRF
  const cookieStore = await cookies();
  const cookieState = cookieStore.get("lh_meta_ads_oauth_state")?.value;
  if (!cookieState || cookieState !== payload.s) {
    return redirectToCompany(payload.c, "?integration_error=state_mismatch");
  }
  cookieStore.delete("lh_meta_ads_oauth_state");

  // Reconfere permissão (pode ter mudado entre connect e callback).
  const auth = await authorizeVaultAccess(payload.c, { checkCofreModule: false });
  if (!auth.ok || !auth.canWrite) {
    return redirectToCompany(payload.c, "?integration_error=forbidden");
  }

  let token: string;
  let expiresIn: number;
  try {
    ({ token, expiresIn } = await metaAdsExchangeCode(code));
  } catch (e: any) {
    console.error("[meta-ads-oauth] exchange failed:", e?.message);
    return redirectToCompany(payload.c, "?integration_error=meta_token_failed");
  }

  // Sem ads_read não adianta gravar a conexão — o picker viria vazio.
  const scopes = await metaAdsGrantedScopes(token);
  if (scopes.length && !scopes.includes("ads_read")) {
    return redirectToCompany(payload.c, "?integration_error=ads_read_nao_concedido");
  }

  const me = await metaAdsMe(token).catch(() => ({ id: "", name: undefined, email: undefined }));

  // Um registro "raiz" por empresa (accountId=null) até o usuário escolher a conta,
  // igual ao fluxo do Google.
  const data = {
    accessTokenEnc: metaTokenCrypto.encrypt(token),
    refreshTokenEnc: null, // a Meta não tem refresh token — reconectar quando expirar
    tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
    scopes,
    googleEmail: me.email ?? null, // campos genéricos do model: identidade de quem autorizou
    googleName: me.name ?? null,
    status: "ACTIVE" as const,
    lastError: null,
  };

  // Diferente do Google, o token da Meta expira a cada ~60 dias — "Reconectar" é
  // rotina. Por isso renovamos o token de TODAS as conexões META_ADS da empresa
  // (vieram da mesma autorização) em vez de criar outra raiz e duplicar o card.
  const existing = await prisma.marketingIntegration.findMany({
    where: { companyId: payload.c, provider: "META_ADS" },
    select: { id: true },
  });
  if (existing.length) {
    await prisma.marketingIntegration.updateMany({
      where: { id: { in: existing.map((i) => i.id) } },
      data,
    });
  } else {
    await prisma.marketingIntegration.create({
      data: {
        companyId: payload.c,
        provider: "META_ADS",
        accountId: null,
        createdById: auth.userId,
        ...data,
      },
    });
  }

  return redirectToCompany(payload.c, "?integration_success=1");
}

function redirectToCompany(companyId: string | null, qs: string): NextResponse {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const path = companyId ? `/empresas/${companyId}` : "/empresas";
  return NextResponse.redirect(`${base.replace(/\/$/, "")}${path}${qs}`);
}
