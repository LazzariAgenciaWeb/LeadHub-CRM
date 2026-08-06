import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { getEffectiveSession } from "@/lib/effective-session";
import { buildBlingAuthorizeUrl, isBlingConfigured } from "@/lib/bling";

// GET /api/integrations/bling/connect
//
// Inicia o OAuth do Bling. É por empresa (na prática só a AZZ conecta): usa o
// companyId da sessão efetiva (funciona também quando o SUPER_ADMIN está
// impersonando a AZZ). Gera state aleatório em cookie httpOnly (anti-CSRF) e
// redireciona pro Bling. O callback valida o cookie.
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any)?.role as string;
  const sessionCompanyId = (session.user as any)?.companyId as string | undefined;
  const userId = (session.user as any)?.id as string | undefined;

  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão para conectar o Bling" }, { status: 403 });
  }

  // SUPER_ADMIN escolhe a empresa via ?companyId= (não tem companyId de sessão).
  // ADMIN sempre usa a própria empresa — ignora qualquer companyId passado.
  const queryCompanyId = new URL(req.url).searchParams.get("companyId") || undefined;
  const companyId = role === "SUPER_ADMIN" ? queryCompanyId : sessionCompanyId;

  if (!companyId) {
    return NextResponse.json(
      { error: "Selecione a empresa (a AZZ) antes de conectar o Bling." },
      { status: 400 }
    );
  }
  if (!isBlingConfigured()) {
    return NextResponse.json(
      { error: "Bling não configurado no servidor (BLING_CLIENT_ID / BLING_CLIENT_SECRET)." },
      { status: 500 }
    );
  }

  const stateRaw = randomBytes(24).toString("base64url");
  const statePayload = JSON.stringify({ s: stateRaw, c: companyId, u: userId ?? null });
  const stateB64 = Buffer.from(statePayload).toString("base64url");

  const cookieStore = await cookies();
  cookieStore.set({
    name: "lh_bling_state",
    value: stateRaw,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10, // 10 min
    path: "/",
  });

  try {
    return NextResponse.redirect(buildBlingAuthorizeUrl(stateB64));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
