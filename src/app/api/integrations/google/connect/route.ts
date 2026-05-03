import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { buildAuthorizeUrl, type GoogleService } from "@/lib/google-oauth";
import { assertModule } from "@/lib/billing";

// GET /api/integrations/google/connect?companyId=X&services=ga4,sc[,gbp]
//
// Inicia o fluxo OAuth: gera state aleatório, grava em cookie httpOnly e
// redireciona o usuário pra Google. O callback valida o cookie pra evitar CSRF.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId");
  const servicesRaw = url.searchParams.get("services") || "ga4,sc";

  if (!companyId) {
    return NextResponse.json({ error: "companyId obrigatório" }, { status: 400 });
  }

  // fix A3 — gate de módulo marketing antes de iniciar o fluxo OAuth
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "marketing");
  if (!gate.ok) return gate.response;

  // Reusa a permissão do cofre (mesmas regras: SUPER_ADMIN, ADMIN da pai, ADMIN da empresa).
  // Skip gate de cofre — já gateamos `marketing` acima.
  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) return NextResponse.json({ error: "Sem permissão para conectar integrações" }, { status: 403 });

  const services = servicesRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is GoogleService => s === "ga4" || s === "sc" || s === "gbp");

  if (services.length === 0) {
    return NextResponse.json({ error: "services inválidos (use: ga4,sc,gbp)" }, { status: 400 });
  }

  const stateRaw = randomBytes(24).toString("base64url");
  const statePayload = JSON.stringify({ s: stateRaw, c: companyId, sv: services });
  const stateB64 = Buffer.from(statePayload).toString("base64url");

  // Grava cookie httpOnly com o state — vamos comparar no callback
  const cookieStore = await cookies();
  cookieStore.set({
    name: "lh_oauth_state",
    value: stateRaw,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10, // 10min
    path: "/",
  });

  try {
    const authorizeUrl = buildAuthorizeUrl({
      state: stateB64,
      services,
    });
    return NextResponse.redirect(authorizeUrl);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
