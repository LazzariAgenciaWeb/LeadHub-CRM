import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { assertModule } from "@/lib/billing";
import { buildFacebookAuthorizeUrl } from "@/lib/facebook";

// GET /api/integrations/facebook/connect?companyId=X
export async function GET(req: NextRequest) {
  const companyId = new URL(req.url).searchParams.get("companyId");
  if (!companyId) return NextResponse.json({ error: "companyId obrigatório" }, { status: 400 });

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "instagram");
  if (!gate.ok) return gate.response;

  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canWrite) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const stateRaw = randomBytes(24).toString("base64url");
  const stateB64 = Buffer.from(JSON.stringify({ s: stateRaw, c: companyId })).toString("base64url");

  const cookieStore = await cookies();
  cookieStore.set({
    name: "lh_fb_oauth_state",
    value: stateRaw,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    path: "/",
  });

  try {
    return NextResponse.redirect(buildFacebookAuthorizeUrl(stateB64));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
