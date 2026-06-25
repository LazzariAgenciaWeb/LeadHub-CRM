import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { fbExchangeCode, fbLongLivedUserToken, fbGetPages, fbSubscribePage, fbTokenCrypto, FB_SCOPES } from "@/lib/facebook";

// GET /api/integrations/facebook/callback?code=...&state=...
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error_description") || url.searchParams.get("error");

  if (error) return redirect(null, `?integration_error=${encodeURIComponent(error)}`);
  if (!code || !state) return redirect(null, "?integration_error=missing_params");

  let payload: { s: string; c: string };
  try {
    payload = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch {
    return redirect(null, "?integration_error=invalid_state");
  }

  const cookieStore = await cookies();
  const cookieState = cookieStore.get("lh_fb_oauth_state")?.value;
  if (!cookieState || cookieState !== payload.s) return redirect(payload.c, "?integration_error=state_mismatch");
  cookieStore.delete("lh_fb_oauth_state");

  const auth = await authorizeVaultAccess(payload.c, { checkCofreModule: false });
  if (!auth.ok || !auth.canWrite) return redirect(payload.c, "?integration_error=forbidden");

  try {
    const shortToken = await fbExchangeCode(code);
    const userToken = await fbLongLivedUserToken(shortToken);
    const pages = await fbGetPages(userToken);
    if (pages.length === 0) return redirect(payload.c, "?integration_error=no_pages");

    for (const page of pages) {
      await prisma.facebookPage.upsert({
        where: { pageId: page.id },
        create: {
          companyId: payload.c,
          pageId: page.id,
          name: page.name,
          pageAccessTokenEnc: fbTokenCrypto.encrypt(page.access_token),
          scopes: FB_SCOPES,
          status: "ACTIVE",
          createdById: auth.userId,
        },
        update: {
          companyId: payload.c,
          name: page.name,
          pageAccessTokenEnc: fbTokenCrypto.encrypt(page.access_token),
          status: "ACTIVE",
          lastError: null,
        },
      });
      // Assina a página aos webhooks (best-effort).
      await fbSubscribePage(page.id, page.access_token).catch(() => {});
    }
  } catch (e: any) {
    console.error("[facebook-oauth] callback:", e?.message);
    return redirect(payload.c, `?integration_error=${encodeURIComponent("fb_failed")}`);
  }

  return redirect(payload.c, "?integration_success=facebook");
}

function redirect(companyId: string | null, qs: string): NextResponse {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const path = companyId ? `/empresas/${companyId}` : "/empresas";
  return NextResponse.redirect(`${base.replace(/\/$/, "")}${path}${qs}`);
}
