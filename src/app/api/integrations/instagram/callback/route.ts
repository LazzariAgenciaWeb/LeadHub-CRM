import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchProfile,
  tokenCrypto,
  IG_SCOPES,
} from "@/lib/instagram-oauth";
import { recordIgCallback } from "@/lib/instagram-debug";

// GET /api/integrations/instagram/callback?code=...&state=...
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorReason = url.searchParams.get("error_description") || error;

  // Helper: registra o passo no buffer de diagnóstico e redireciona.
  const fail = (companyId: string | null, step: string, qsCode: string, detail?: string) => {
    recordIgCallback({ companyId, step, ok: false, detail });
    return redirectToCompany(companyId, `?integration_error=${encodeURIComponent(qsCode)}`);
  };

  try {
    if (error) {
      return fail(null, "ig_returned_error", errorReason || error, errorReason || error);
    }
    if (!code || !state) {
      return fail(null, "missing_params", "missing_params", `code=${!!code} state=${!!state}`);
    }

    // Decodifica state
    let payload: { s: string; c: string };
    try {
      payload = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    } catch {
      return fail(null, "invalid_state", "invalid_state");
    }

    // CSRF: confere com o cookie
    const cookieStore = await cookies();
    const cookieState = cookieStore.get("lh_ig_oauth_state")?.value;
    if (!cookieState || cookieState !== payload.s) {
      return fail(
        payload.c,
        "state_mismatch",
        "state_mismatch",
        `cookiePresent=${!!cookieState} match=${cookieState === payload.s}`,
      );
    }
    cookieStore.delete("lh_ig_oauth_state");

    // Permissão (sessão efetiva)
    const auth = await authorizeVaultAccess(payload.c, { checkCofreModule: false });
    if (!auth.ok || !auth.canWrite) {
      return fail(payload.c, "forbidden", "forbidden", auth.ok ? "no canWrite" : auth.error);
    }

    // 1) code → token curto
    let shortToken;
    try {
      shortToken = await exchangeCodeForToken(code);
    } catch (e: any) {
      return fail(payload.c, "token_exchange_failed", "token_exchange_failed", e?.message?.slice(0, 300));
    }

    // 2) token curto → token longo (60 dias)
    let longToken;
    try {
      longToken = await exchangeForLongLivedToken(shortToken.access_token);
    } catch (e: any) {
      return fail(payload.c, "long_token_failed", "long_token_failed", e?.message?.slice(0, 300));
    }

    // 3) perfil da conta IG
    let profile;
    try {
      profile = await fetchProfile(longToken.access_token);
    } catch (e: any) {
      return fail(payload.c, "profile_failed", "profile_failed", e?.message?.slice(0, 300));
    }

    const expiresAt = new Date(Date.now() + longToken.expires_in * 1000);
    const grantedScopes = Array.isArray(shortToken.permissions)
      ? shortToken.permissions
      : typeof shortToken.permissions === "string"
        ? shortToken.permissions.split(",").map((s) => s.trim()).filter(Boolean)
        : IG_SCOPES;

    // 4) upsert InstagramAccount por igUserId
    try {
      await prisma.instagramAccount.upsert({
        where: { igUserId: profile.user_id },
        create: {
          companyId: payload.c,
          igUserId: profile.user_id,
          username: profile.username ?? null,
          name: profile.name ?? null,
          profilePictureUrl: profile.profile_picture_url ?? null,
          accessTokenEnc: tokenCrypto.encrypt(longToken.access_token),
          tokenExpiresAt: expiresAt,
          scopes: grantedScopes,
          status: "ACTIVE",
          lastError: null,
          createdById: auth.userId,
        },
        update: {
          companyId: payload.c,
          username: profile.username ?? null,
          name: profile.name ?? null,
          profilePictureUrl: profile.profile_picture_url ?? null,
          accessTokenEnc: tokenCrypto.encrypt(longToken.access_token),
          tokenExpiresAt: expiresAt,
          scopes: grantedScopes,
          status: "ACTIVE",
          lastError: null,
        },
      });
    } catch (e: any) {
      return fail(payload.c, "save_failed", "save_failed", e?.message?.slice(0, 300));
    }

    recordIgCallback({
      companyId: payload.c,
      step: "saved",
      ok: true,
      detail: `@${profile.username ?? profile.user_id}`,
    });
    return redirectToCompany(payload.c, "?integration_success=instagram");
  } catch (e: any) {
    // Exceção inesperada fora dos try específicos.
    console.error("[instagram-oauth] callback unexpected error:", e?.message);
    recordIgCallback({ companyId: null, step: "unexpected_exception", ok: false, detail: e?.message?.slice(0, 300) });
    return redirectToCompany(null, "?integration_error=unexpected");
  }
}

function redirectToCompany(companyId: string | null, qs: string): NextResponse {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const path = companyId ? `/empresas/${companyId}` : "/empresas";
  return NextResponse.redirect(`${base.replace(/\/$/, "")}${path}${qs}`);
}
