/**
 * Helper pra obter um access_token válido de uma MarketingIntegration.
 * Renova automaticamente se estiver expirado e atualiza o registro no banco.
 */

import { prisma } from "../prisma";
import { refreshAccessToken, tokenCrypto, isTokenExpired } from "../google-oauth";

export interface GoogleAuthContext {
  accessToken: string;
  integrationId: string;
}

/**
 * Carrega + (se necessário) renova o access token de uma integração.
 * Lança erro se não conseguir.
 */
export async function getValidAccessToken(integrationId: string): Promise<GoogleAuthContext> {
  const integ = await prisma.marketingIntegration.findUnique({
    where: { id: integrationId },
    select: {
      id: true,
      accessTokenEnc: true,
      refreshTokenEnc: true,
      tokenExpiresAt: true,
      status: true,
    },
  });
  if (!integ) throw new Error("Integração não encontrada");
  if (integ.status === "DISCONNECTED") throw new Error("Integração desconectada");

  // Se ainda válido, retorna o que tem
  if (integ.accessTokenEnc && !isTokenExpired(integ.tokenExpiresAt)) {
    return {
      accessToken: tokenCrypto.decrypt(integ.accessTokenEnc),
      integrationId: integ.id,
    };
  }

  // Precisa renovar
  if (!integ.refreshTokenEnc) {
    await prisma.marketingIntegration.update({
      where: { id: integ.id },
      data: { status: "EXPIRED", lastError: "Sem refresh_token — reconecte a integração" },
    });
    throw new Error("Sem refresh_token — reconecte a integração");
  }

  try {
    const refreshToken = tokenCrypto.decrypt(integ.refreshTokenEnc);
    const fresh = await refreshAccessToken(refreshToken);
    const expiresAt = new Date(Date.now() + fresh.expires_in * 1000);

    await prisma.marketingIntegration.update({
      where: { id: integ.id },
      data: {
        accessTokenEnc: tokenCrypto.encrypt(fresh.access_token),
        tokenExpiresAt: expiresAt,
        status: "ACTIVE",
        lastError: null,
      },
    });
    return { accessToken: fresh.access_token, integrationId: integ.id };
  } catch (e: any) {
    await prisma.marketingIntegration.update({
      where: { id: integ.id },
      data: {
        status: "EXPIRED",
        lastError: `Falha ao renovar token: ${e.message}`,
      },
    });
    throw new Error(`Falha ao renovar token: ${e.message}`);
  }
}

/** Wrapper de fetch que adiciona Authorization Bearer e trata 401. */
export async function googleFetch(
  integrationId: string,
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const { accessToken } = await getValidAccessToken(integrationId);
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, { ...init, headers });
}
