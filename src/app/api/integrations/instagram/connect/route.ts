import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { buildAuthorizeUrl } from "@/lib/instagram-oauth";
import { assertModule } from "@/lib/billing";

// GET /api/integrations/instagram/connect?companyId=X
//
// Inicia o fluxo OAuth do Instagram (API com Login do Instagram): gera state
// aleatório, grava em cookie httpOnly e redireciona o usuário pro Instagram.
// O callback valida o cookie pra evitar CSRF.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId");

  if (!companyId) {
    return NextResponse.json({ error: "companyId obrigatório" }, { status: 400 });
  }

  // Gate do módulo Instagram antes de iniciar o fluxo OAuth.
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "instagram");
  if (!gate.ok) return gate.response;

  // Reusa a permissão do cofre (SUPER_ADMIN, ADMIN da pai, ADMIN da empresa).
  // Skip gate de cofre — já gateamos `instagram` acima.
  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) {
    return NextResponse.json({ error: "Sem permissão para conectar integrações" }, { status: 403 });
  }

  // state = nonce aleatório (comparado via cookie) + companyId (usado no callback).
  const stateRaw = randomBytes(24).toString("base64url");
  const statePayload = JSON.stringify({ s: stateRaw, c: companyId });
  const stateB64 = Buffer.from(statePayload).toString("base64url");

  const cookieStore = await cookies();
  cookieStore.set({
    name: "lh_ig_oauth_state",
    value: stateRaw,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10, // 10min
    path: "/",
  });

  try {
    const authorizeUrl = buildAuthorizeUrl({ state: stateB64 });
    return NextResponse.redirect(authorizeUrl);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
