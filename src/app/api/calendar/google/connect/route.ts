import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { getEffectiveSession } from "@/lib/effective-session";
import { buildAuthorizeUrl, googleConfig } from "@/lib/google-oauth";

// GET /api/calendar/google/connect
//
// Inicia o fluxo OAuth pessoal: gera state aleatório, grava em cookie httpOnly
// e redireciona o usuário pra Google. Cada atendente conecta a própria agenda.
export async function GET(_req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any)?.id as string;
  if (!userId) return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });

  const stateRaw = randomBytes(24).toString("base64url");
  const statePayload = JSON.stringify({ s: stateRaw, u: userId });
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
