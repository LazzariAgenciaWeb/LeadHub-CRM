/**
 * Google OAuth helper — usado pelas integrações GA4, Search Console e (futuro) GBP.
 *
 * Fluxo:
 *  1. /api/integrations/google/connect?companyId=X&services=ga4,sc
 *     → gera authorize URL e redireciona o usuário pra Google
 *  2. Google redireciona pra /api/integrations/google/callback?code=...&state=...
 *     → trocamos code por tokens, gravamos em MarketingIntegration (criptografados)
 *
 * Tokens são gravados via src/lib/crypto.ts (AES-256-GCM).
 */

import { encryptSecret, decryptSecret } from "./crypto";

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

const REDIRECT_URI = `${BASE_URL.replace(/\/$/, "")}/api/integrations/google/callback`;

const AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type GoogleService = "ga4" | "sc" | "gbp";

const SCOPES_BY_SERVICE: Record<GoogleService, string[]> = {
  ga4: [
    "https://www.googleapis.com/auth/analytics.readonly",
  ],
  sc: [
    "https://www.googleapis.com/auth/webmasters.readonly",
  ],
  gbp: [
    "https://www.googleapis.com/auth/business.manage",
  ],
};

const ALWAYS_INCLUDE_SCOPES = ["openid", "email", "profile"];

/** Garante que as variáveis estão setadas — usar no início de cada handler. */
export function assertGoogleOAuthConfigured() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "Google OAuth não configurado. Defina GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET no .env"
    );
  }
}

/** Monta a URL de autorização. State carrega contexto pra usarmos no callback. */
export function buildAuthorizeUrl(opts: {
  state: string;
  services: GoogleService[];
  loginHint?: string;
}): string {
  assertGoogleOAuthConfigured();
  const scopes = new Set<string>(ALWAYS_INCLUDE_SCOPES);
  for (const s of opts.services) {
    SCOPES_BY_SERVICE[s].forEach((scope) => scopes.add(scope));
  }
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: Array.from(scopes).join(" "),
    access_type: "offline",       // queremos refresh_token
    prompt: "consent",             // força tela de consentimento → garante refresh_token mesmo se já autorizou antes
    include_granted_scopes: "true",
    state: opts.state,
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return `${AUTH_URL}?${params.toString()}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;        // segundos
  refresh_token?: string;    // só vem na primeira autorização (ou com prompt=consent)
  scope: string;             // espaço-separado
  token_type: "Bearer";
  id_token?: string;
}

/** Troca code por tokens. */
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  assertGoogleOAuthConfigured();
  const body = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Falha ao trocar code por token: ${r.status} ${txt}`);
  }
  return r.json();
}

/** Renova access_token usando refresh_token. */
export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
  scope: string;
}> {
  assertGoogleOAuthConfigured();
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Falha ao renovar token: ${r.status} ${txt}`);
  }
  return r.json();
}

/** Decodifica id_token (sem validação de assinatura — apenas para extrair email/name). */
export function decodeIdToken(idToken: string | undefined | null): {
  email?: string;
  name?: string;
  sub?: string;
} {
  if (!idToken) return {};
  try {
    const [, payload] = idToken.split(".");
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return { email: json.email, name: json.name, sub: json.sub };
  } catch {
    return {};
  }
}

/** Helpers de cripto reexportados pra ficar tudo num só lugar. */
export const tokenCrypto = {
  encrypt: (s: string) => (s ? encryptSecret(s) : ""),
  decrypt: (s: string | null | undefined) => (s ? decryptSecret(s) : ""),
};

/** Confere se o token salvo está perto de expirar (margem de 60s). */
export function isTokenExpired(expiresAt: Date | null | undefined): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - Date.now() < 60_000;
}

/** Detecta quais serviços foram autorizados a partir da string `scope` retornada pelo Google. */
export function detectAuthorizedServices(scopeString: string): GoogleService[] {
  const scopes = scopeString.split(/\s+/);
  const result: GoogleService[] = [];
  if (scopes.includes("https://www.googleapis.com/auth/analytics.readonly")) result.push("ga4");
  if (scopes.includes("https://www.googleapis.com/auth/webmasters.readonly")) result.push("sc");
  if (scopes.includes("https://www.googleapis.com/auth/business.manage")) result.push("gbp");
  return result;
}

export const googleConfig = {
  clientId: CLIENT_ID,
  redirectUri: REDIRECT_URI,
  baseUrl: BASE_URL,
};
