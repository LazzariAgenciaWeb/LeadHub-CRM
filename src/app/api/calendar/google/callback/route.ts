import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  exchangeCodeForTokens,
  decodeIdToken,
  tokenCrypto,
  googleConfig,
} from "@/lib/google-oauth";

// GET /api/calendar/google/callback
//
// Recebe o code do Google, valida o state contra o cookie httpOnly,
// troca o code por tokens e grava (criptografados) em UserGoogleConnection.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const redirectBase = `${googleConfig.baseUrl.replace(/\/$/, "")}/calendario`;

  if (error) {
    return NextResponse.redirect(`${redirectBase}?google_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${redirectBase}?google_error=missing_params`);
  }

  // Decodifica state
  let payload: { s: string; u: string };
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    payload = JSON.parse(decoded);
  } catch {
    return NextResponse.redirect(`${redirectBase}?google_error=invalid_state`);
  }

  // Confere CSRF — state em cookie deve bater com o decodificado
  const cookieStore = await cookies();
  const cookieState = cookieStore.get("lh_calendar_oauth_state")?.value;
  if (!cookieState || cookieState !== payload.s) {
    return NextResponse.redirect(`${redirectBase}?google_error=csrf_mismatch`);
  }
  cookieStore.delete("lh_calendar_oauth_state");

  // Confirma usuário existe (segurança extra — userId vem do state)
  const user = await prisma.user.findUnique({
    where: { id: payload.u },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.redirect(`${redirectBase}?google_error=user_not_found`);
  }

  // Troca code por tokens (passando o redirectUri específico do Calendar)
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, googleConfig.calendarRedirectUri);
  } catch (e: any) {
    return NextResponse.redirect(`${redirectBase}?google_error=${encodeURIComponent(e.message || "exchange_failed")}`);
  }

  const idInfo = decodeIdToken(tokens.id_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const scopes = tokens.scope ? tokens.scope.split(/\s+/) : [];

  // Upsert: 1 conexão por (user, service="calendar")
  await prisma.userGoogleConnection.upsert({
    where: { userId_service: { userId: user.id, service: "calendar" } },
    create: {
      userId: user.id,
      service: "calendar",
      googleEmail: idInfo.email,
      googleName: idInfo.name,
      accessTokenEnc: tokenCrypto.encrypt(tokens.access_token),
      refreshTokenEnc: tokens.refresh_token ? tokenCrypto.encrypt(tokens.refresh_token) : null,
      tokenExpiresAt: expiresAt,
      scopes,
      status: "ACTIVE",
    },
    update: {
      googleEmail: idInfo.email,
      googleName: idInfo.name,
      accessTokenEnc: tokenCrypto.encrypt(tokens.access_token),
      // Só sobrescreve refresh_token se vier um novo (Google só manda na 1ª autorização ou com prompt=consent)
      ...(tokens.refresh_token ? { refreshTokenEnc: tokenCrypto.encrypt(tokens.refresh_token) } : {}),
      tokenExpiresAt: expiresAt,
      scopes,
      status: "ACTIVE",
      lastError: null,
    },
  });

  return NextResponse.redirect(`${redirectBase}?google_connected=1`);
}
