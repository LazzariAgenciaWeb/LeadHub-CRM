import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { getEffectiveSession } from "@/lib/effective-session";
import { buildAuthorizeUrl, googleConfig } from "@/lib/google-oauth";
import { assertModule } from "@/lib/billing";

/** Aceita só caminho interno ("/algo") — nunca URL absoluta nem "//host". */
function safeReturnTo(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

// GET /api/calendar/google/connect[?returnTo=/caminho]
//
// Inicia o fluxo OAuth pessoal: gera state aleatório, grava em cookie httpOnly
// e redireciona o usuário pra Google. Cada atendente conecta a própria agenda.
// `returnTo` traz o usuário de volta pra tela de onde ele clicou (o padrão é
// /calendario) — a reconexão é pedida também na tela de Assistentes.
export async function GET(_req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "calendario");
  if (!gate.ok) return gate.response;

  const userId = (session.user as any)?.id as string;
  if (!userId) return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });

  const returnTo = safeReturnTo(new URL(_req.url).searchParams.get("returnTo"));

  const stateRaw = randomBytes(24).toString("base64url");
  const statePayload = JSON.stringify({ s: stateRaw, u: userId, ...(returnTo ? { r: returnTo } : {}) });
  const stateB64 = Buffer.from(statePayload).toString("base64url");

  const cookieStore = await cookies();
  cookieStore.set({
    name: "lh_calendar_oauth_state",
    value: stateRaw,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    path: "/",
  });

  try {
    const authorizeUrl = buildAuthorizeUrl({
      state: stateB64,
      services: ["calendar"],
      redirectUri: googleConfig.calendarRedirectUri,
    });
    return NextResponse.redirect(authorizeUrl);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
