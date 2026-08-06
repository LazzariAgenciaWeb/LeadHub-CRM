import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForTokens, saveBlingConnection } from "@/lib/bling";

// GET /api/integrations/bling/callback?code=...&state=...
//
// Volta do OAuth do Bling: valida o state (cookie httpOnly), troca o code por
// tokens e grava a conexão (tokens cifrados) em BlingIntegration.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return redirectToConfig(null, `bling_error=${encodeURIComponent(error)}`);
  if (!code || !state) return redirectToConfig(null, "bling_error=missing_params");

  let payload: { s: string; c: string; u: string | null };
  try {
    payload = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch {
    return redirectToConfig(null, "bling_error=invalid_state");
  }

  // CSRF: confere com o cookie
  const cookieStore = await cookies();
  const cookieState = cookieStore.get("lh_bling_state")?.value;
  if (!cookieState || cookieState !== payload.s) {
    return redirectToConfig(payload.c, "bling_error=state_mismatch");
  }
  cookieStore.delete("lh_bling_state");

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveBlingConnection(payload.c, tokens, payload.u);
  } catch (e: any) {
    console.error("[bling-oauth] callback falhou:", e?.message);
    return redirectToConfig(payload.c, `bling_error=${encodeURIComponent("token_exchange_failed")}`);
  }

  return redirectToConfig(payload.c, "bling_success=1");
}

// Volta pra tela do Bling, preservando a empresa (pro SUPER_ADMIN cair na
// empresa que acabou de conectar, e não no seletor vazio).
function redirectToConfig(companyId: string | null, qs: string): NextResponse {
  const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  const company = companyId ? `&companyId=${companyId}` : "";
  return NextResponse.redirect(
    `${base.replace(/\/$/, "")}/configuracoes?secao=integracoes-bling${company}&${qs}`
  );
}
