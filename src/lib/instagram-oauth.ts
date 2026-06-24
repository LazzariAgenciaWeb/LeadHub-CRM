/**
 * Instagram OAuth helper — "API com Login do Instagram" (fluxo novo da Meta,
 * sem Página do Facebook). Usado pelo módulo de automação (estilo ManyChat).
 *
 * Fluxo:
 *  1. /api/integrations/instagram/connect?companyId=X
 *     → gera authorize URL e redireciona o usuário pro Instagram.
 *  2. Instagram redireciona pra /api/integrations/instagram/callback?code=...&state=...
 *     → trocamos `code` por um token CURTO (1h), depois por um token LONGO (60d),
 *       buscamos o perfil e gravamos em InstagramAccount (token cifrado).
 *
 * Diferenças importantes vs. Google OAuth:
 *  - O `client_id` aqui é o **Instagram App ID** (achado no produto "Instagram"
 *    do app no Meta for Developers), NÃO o App ID do Facebook.
 *  - Scopes são separados por vírgula (não espaço).
 *  - Não existe refresh_token: renovamos o token longo via `ig_refresh_token`.
 *
 * Tokens são gravados via src/lib/crypto.ts (AES-256-GCM).
 *
 * Docs: node_modules/next/dist/docs/ (este Next.js tem breaking changes) +
 * developers.facebook.com/docs/instagram-platform.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { encryptSecret, decryptSecret } from "./crypto";

const APP_ID = process.env.INSTAGRAM_APP_ID || "";
const APP_SECRET = process.env.INSTAGRAM_APP_SECRET || "";
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

const REDIRECT_URI = `${BASE_URL.replace(/\/$/, "")}/api/integrations/instagram/callback`;

// Endpoints da plataforma Instagram (com Login do Instagram)
const AUTH_URL = "https://www.instagram.com/oauth/authorize";
const TOKEN_URL = "https://api.instagram.com/oauth/access_token"; // short-lived
const GRAPH = "https://graph.instagram.com";                      // long-lived + API

// Scopes mínimos pra automação: ler perfil, gerir mensagens e comentários.
export const IG_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
];

/** Garante que as variáveis estão setadas — usar no início de cada handler. */
export function assertInstagramOAuthConfigured() {
  if (!APP_ID || !APP_SECRET) {
    throw new Error(
      "Instagram OAuth não configurado. Defina INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET no .env",
    );
  }
}

/** Monta a URL de autorização. `state` carrega contexto pro callback (anti-CSRF). */
export function buildAuthorizeUrl(opts: { state: string }): string {
  assertInstagramOAuthConfigured();
  const params = new URLSearchParams({
    client_id: APP_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: IG_SCOPES.join(","),
    state: opts.state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export interface IgShortTokenResponse {
  access_token: string;
  user_id: string | number;
  permissions?: string[] | string;
}

/**
 * Troca o `code` por um token CURTO (~1h). A Meta já retornou em dois formatos
 * historicamente (objeto plano e `{ data: [...] }`) — normalizamos os dois.
 */
export async function exchangeCodeForToken(code: string): Promise<IgShortTokenResponse> {
  assertInstagramOAuthConfigured();
  const body = new URLSearchParams({
    client_id: APP_ID,
    client_secret: APP_SECRET,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
    code,
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const txt = await r.text();
    // Diagnóstico: inclui o redirect_uri que enviamos + tamanho/formato do code
    // (sem expor o code inteiro) pra comparar com o cadastrado no Meta.
    const codeInfo = `codeLen=${code.length} hasHash=${code.includes("#")} hasSpace=${code.includes(" ")}`;
    throw new Error(
      `Falha ao trocar code por token: ${r.status} ${txt} | redirect_uri=${REDIRECT_URI} | ${codeInfo}`,
    );
  }
  const json: any = await r.json();
  const node = Array.isArray(json?.data) ? json.data[0] : json;
  if (!node?.access_token) {
    throw new Error("Resposta de token sem access_token");
  }
  return {
    access_token: node.access_token,
    user_id: node.user_id,
    permissions: node.permissions,
  };
}

export interface IgLongTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // segundos (~5184000 = 60 dias)
}

/** Troca o token curto por um token LONGO (60 dias). */
export async function exchangeForLongLivedToken(shortToken: string): Promise<IgLongTokenResponse> {
  assertInstagramOAuthConfigured();
  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: APP_SECRET,
    access_token: shortToken,
  });
  const r = await fetch(`${GRAPH}/access_token?${params.toString()}`);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Falha ao obter token longo: ${r.status} ${txt}`);
  }
  return r.json();
}

/**
 * Renova um token longo (válido enquanto tiver >24h de vida e <60d).
 * Usado pelo cron de renovação antes de `tokenExpiresAt`.
 */
export async function refreshLongLivedToken(longToken: string): Promise<IgLongTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: longToken,
  });
  const r = await fetch(`${GRAPH}/refresh_access_token?${params.toString()}`);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Falha ao renovar token longo: ${r.status} ${txt}`);
  }
  return r.json();
}

export interface IgProfile {
  user_id: string; // campo `user_id` do /me (id "profissional")
  // campo `id` do /me (app-scoped) — geralmente é o que o webhook usa em
  // entry.id. Pode ser igual ou diferente de user_id.
  scoped_id: string | null;
  username?: string;
  name?: string;
  profile_picture_url?: string;
}

/** Busca o perfil da conta autenticada. Captura os DOIS ids (user_id e id). */
export async function fetchProfile(accessToken: string): Promise<IgProfile> {
  const params = new URLSearchParams({
    fields: "user_id,username,name,profile_picture_url",
    access_token: accessToken,
  });
  const r = await fetch(`${GRAPH}/me?${params.toString()}`);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Falha ao buscar perfil IG: ${r.status} ${txt}`);
  }
  const j: any = await r.json();
  const userId = j.user_id != null ? String(j.user_id) : null;
  const nodeId = j.id != null ? String(j.id) : null;
  return {
    user_id: String(userId ?? nodeId),
    scoped_id: nodeId && nodeId !== userId ? nodeId : null,
    username: j.username,
    name: j.name,
    profile_picture_url: j.profile_picture_url,
  };
}

/**
 * Assina a CONTA aos webhooks do app. Além de assinar o campo no painel, cada
 * conta via Login do Instagram precisa ser assinada para entregar eventos reais.
 * POST graph.instagram.com/me/subscribed_apps?subscribed_fields=comments,messages
 * (usa `me` + o token da própria conta, evitando ambiguidade de id.)
 */
export async function subscribeAccountWebhooks(
  accessToken: string,
  fields: string[] = ["comments", "messages", "messaging_postbacks"],
): Promise<{ ok: boolean; status: number; body: any }> {
  const params = new URLSearchParams({
    subscribed_fields: fields.join(","),
    access_token: accessToken,
  });
  const r = await fetch(`${GRAPH}/me/subscribed_apps?${params.toString()}`, { method: "POST" });
  const txt = await r.text();
  let body: any = txt;
  try { body = JSON.parse(txt); } catch { /* mantém texto */ }
  return { ok: r.ok, status: r.status, body };
}

/** Lê o estado atual de assinatura da conta (quais campos estão ativos). */
export async function getSubscribedApps(
  accessToken: string,
): Promise<{ ok: boolean; status: number; body: any }> {
  const params = new URLSearchParams({ access_token: accessToken });
  const r = await fetch(`${GRAPH}/me/subscribed_apps?${params.toString()}`);
  const txt = await r.text();
  let body: any = txt;
  try { body = JSON.parse(txt); } catch { /* mantém texto */ }
  return { ok: r.ok, status: r.status, body };
}

/**
 * Valida a assinatura `X-Hub-Signature-256` que a Meta envia no webhook.
 * A chave de assinatura é o App Secret. Comparação em tempo constante.
 *
 * @param rawBody corpo cru (string) — precisa ser o byte-exato recebido.
 * @param header valor do cabeçalho `x-hub-signature-256` (ex: "sha256=abc...").
 */
export function verifyWebhookSignature(rawBody: string, header: string | null): boolean {
  if (!APP_SECRET || !header) return false;
  const expected = "sha256=" + createHmac("sha256", APP_SECRET).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Helpers de cripto reexportados (mesmo padrão do google-oauth). */
export const tokenCrypto = {
  encrypt: (s: string) => (s ? encryptSecret(s) : ""),
  decrypt: (s: string | null | undefined) => (s ? decryptSecret(s) : ""),
};

/** Confere se o token salvo está perto de expirar (margem de 3 dias). */
export function isTokenExpiringSoon(expiresAt: Date | null | undefined): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000;
}

export const instagramConfig = {
  appId: APP_ID,
  redirectUri: REDIRECT_URI,
  baseUrl: BASE_URL,
  graphBase: GRAPH,
};
