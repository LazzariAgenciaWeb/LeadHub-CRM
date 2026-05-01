/**
 * Helper para Google Calendar API.
 *
 * Lida com:
 *  - Renovação automática de access_token quando expirado
 *  - Listagem de eventos (read-only) por janela de tempo
 *  - Persistência transparente do novo access_token no banco
 */

import { prisma } from "./prisma";
import { isTokenExpired, refreshAccessToken, tokenCrypto } from "./google-oauth";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end:   { dateTime?: string; date?: string; timeZone?: string };
  status?: string;
  htmlLink?: string;
  hangoutLink?: string;
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
  organizer?: { email?: string; displayName?: string; self?: boolean };
}

/**
 * Garante que a conexão tem um access_token válido. Se estiver expirado,
 * renova via refresh_token e persiste o novo token no banco.
 *
 * Retorna o access_token decriptografado pronto pra uso.
 */
export async function ensureValidAccessToken(connectionId: string): Promise<string> {
  const conn = await prisma.userGoogleConnection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      accessTokenEnc: true,
      refreshTokenEnc: true,
      tokenExpiresAt: true,
      status: true,
    },
  });
  if (!conn) throw new Error("Conexão Google não encontrada");
  if (conn.status !== "ACTIVE") throw new Error(`Conexão em estado ${conn.status}`);

  if (!isTokenExpired(conn.tokenExpiresAt)) {
    return tokenCrypto.decrypt(conn.accessTokenEnc);
  }

  const refreshToken = tokenCrypto.decrypt(conn.refreshTokenEnc);
  if (!refreshToken) {
    await prisma.userGoogleConnection.update({
      where: { id: conn.id },
      data: { status: "EXPIRED", lastError: "refresh_token ausente" },
    });
    throw new Error("Sem refresh_token — usuário precisa reconectar");
  }

  try {
    const refreshed = await refreshAccessToken(refreshToken);
    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

    await prisma.userGoogleConnection.update({
      where: { id: conn.id },
      data: {
        accessTokenEnc: tokenCrypto.encrypt(refreshed.access_token),
        tokenExpiresAt: newExpiresAt,
        lastError: null,
      },
    });

    return refreshed.access_token;
  } catch (e: any) {
    await prisma.userGoogleConnection.update({
      where: { id: conn.id },
      data: { status: "EXPIRED", lastError: e?.message ?? "Erro ao renovar token" },
    });
    throw e;
  }
}

/**
 * Lista eventos do calendário primário do usuário, num intervalo.
 *
 * @param connectionId  ID da UserGoogleConnection
 * @param timeMin       data/hora inicial (ISO)
 * @param timeMax       data/hora final (ISO)
 * @param maxResults    limite (default 50)
 */
export async function listPrimaryEvents(
  connectionId: string,
  timeMin: Date,
  timeMax: Date,
  maxResults = 50,
): Promise<GoogleCalendarEvent[]> {
  const accessToken = await ensureValidAccessToken(connectionId);

  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(maxResults),
  });

  const url = `${CALENDAR_API}/calendars/primary/events?${params.toString()}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Google Calendar API: ${r.status} ${txt}`);
  }

  const data = await r.json();
  await prisma.userGoogleConnection.update({
    where: { id: connectionId },
    data: { lastSyncAt: new Date() },
  }).catch(() => { /* não crítico */ });

  return Array.isArray(data.items) ? data.items : [];
}
