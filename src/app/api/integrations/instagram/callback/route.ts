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

// GET /api/integrations/instagram/callback?code=...&state=...
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorReason = url.searchParams.get("error_description") || error;

  if (error) {
    return redirectToCompany(null, `?integration_error=${encodeURIComponent(errorReason || error)}`);
  }
  if (!code || !state) {
    return redirectToCompany(null, "?integration_error=missing_params");
  }

  // Decodifica state
  let payload: { s: string; c: string };
  try {
    payload = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch {
    return redirectToCompany(null, "?integration_error=invalid_state");
  }

  // CSRF: confere com o cookie
  const cookieStore = await cookies();
  const cookieState = cookieStore.get("lh_ig_oauth_state")?.value;
  if (!cookieState || cookieState !== payload.s) {
    return redirectToCompany(payload.c, "?integration_error=state_mismatch");
  }
  cookieStore.delete("lh_ig_oauth_state");

  // Reconfere permissão (pode ter mudado entre connect e callback).
  const auth = await authorizeVaultAccess(payload.c, { checkCofreModule: false });
  if (!auth.ok || !auth.canWrite) {
    return redirectToCompany(payload.c, "?integration_error=forbidden");
  }

  // 1) code → token curto
  let shortToken;
  try {
    shortToken = await exchangeCodeForToken(code);
  } catch (e: any) {
    console.error("[instagram-oauth] short token failed:", e.message);
    return redirectToCompany(payload.c, "?integration_error=token_exchange_failed");
  }

  // 2) token curto → token longo (60 dias)
  let longToken;
  try {
    longToken = await exchangeForLongLivedToken(shortToken.access_token);
  } catch (e: any) {
    console.error("[instagram-oauth] long token failed:", e.message);
    return redirectToCompany(payload.c, "?integration_error=long_token_failed");
  }

  // 3) perfil da conta IG
  let profile;
  try {
    profile = await fetchProfile(longToken.access_token);
  } catch (e: any) {
    console.error("[instagram-oauth] profile fetch failed:", e.message);
    return redirectToCompany(payload.c, "?integration_error=profile_failed");
  }

  const expiresAt = new Date(Date.now() + longToken.expires_in * 1000);
  const grantedScopes = Array.isArray(shortToken.permissions)
    ? shortToken.permissions
    : typeof shortToken.permissions === "string"
      ? shortToken.permissions.split(",").map((s) => s.trim()).filter(Boolean)
      : IG_SCOPES;

  // 4) upsert InstagramAccount por igUserId (chave global única que casa o webhook).
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
    console.error("[instagram-oauth] save failed:", e.message);
    return redirectToCompany(payload.c, "?integration_error=save_failed");
  }

  return redirectToCompany(payload.c, "?integration_success=instagram");
}

function redirectToCompany(companyId: string | null, qs: string): NextResponse {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const path = companyId ? `/empresas/${companyId}` : "/empresas";
  return NextResponse.redirect(`${base.replace(/\/$/, "")}${path}${qs}`);
}
