import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { fbExchangeCode, fbLongLivedUserToken, fbGetPages, fbSubscribePage, fbTokenCrypto, FB_SCOPES } from "@/lib/facebook";
import { recordFbCallback } from "@/lib/instagram-debug";

// GET /api/integrations/facebook/callback?code=...&state=...
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error_description") || url.searchParams.get("error");

  const fail = (companyId: string | null, step: string, qsCode: string, detail?: string) => {
    recordFbCallback({ companyId, step, ok: false, detail });
    return redirect(companyId, `?integration_error=${encodeURIComponent(qsCode)}`);
  };

  try {
    if (error) return fail(null, "fb_returned_error", error, error);
    if (!code || !state) return fail(null, "missing_params", "missing_params", `code=${!!code} state=${!!state}`);

    let payload: { s: string; c: string };
    try {
      payload = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    } catch {
      return fail(null, "invalid_state", "invalid_state");
    }

    const cookieStore = await cookies();
    const cookieState = cookieStore.get("lh_fb_oauth_state")?.value;
    if (!cookieState || cookieState !== payload.s) {
      return fail(payload.c, "state_mismatch", "state_mismatch", `cookiePresent=${!!cookieState}`);
    }
    cookieStore.delete("lh_fb_oauth_state");

    const auth = await authorizeVaultAccess(payload.c, { checkCofreModule: false });
    if (!auth.ok || !auth.canWrite) return fail(payload.c, "forbidden", "forbidden", auth.ok ? "no canWrite" : auth.error);

    let userToken: string;
    try {
      const shortToken = await fbExchangeCode(code);
      userToken = await fbLongLivedUserToken(shortToken);
    } catch (e: any) {
      return fail(payload.c, "token_exchange_failed", "fb_token_failed", e?.message?.slice(0, 300));
    }

    let pages;
    try {
      pages = await fbGetPages(userToken);
    } catch (e: any) {
      return fail(payload.c, "get_pages_failed", "fb_pages_failed", e?.message?.slice(0, 300));
    }
    if (!pages.length) return fail(payload.c, "no_pages", "no_pages", "fbGetPages retornou 0 páginas");

    try {
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
        await fbSubscribePage(page.id, page.access_token).catch(() => {});
      }
    } catch (e: any) {
      return fail(payload.c, "save_failed", "fb_save_failed", e?.message?.slice(0, 300));
    }

    recordFbCallback({ companyId: payload.c, step: "saved", ok: true, detail: `${pages.length} página(s): ${pages.map((p) => p.name).join(", ")}` });
    return redirect(payload.c, "?integration_success=facebook");
  } catch (e: any) {
    console.error("[facebook-oauth] unexpected:", e?.message);
    recordFbCallback({ companyId: null, step: "unexpected_exception", ok: false, detail: e?.message?.slice(0, 300) });
    return redirect(null, "?integration_error=unexpected");
  }
}

function redirect(companyId: string | null, qs: string): NextResponse {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const path = companyId ? `/empresas/${companyId}` : "/empresas";
  return NextResponse.redirect(`${base.replace(/\/$/, "")}${path}${qs}`);
}
