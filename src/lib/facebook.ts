/**
 * Facebook helper — Login do Facebook + Páginas + Messenger.
 *
 * Usa o MESMO Meta app do Instagram (App ID do Facebook), mas o fluxo OAuth é o
 * do Facebook (facebook.com/dialog/oauth) pra obter tokens de Página.
 *
 * Envs: FACEBOOK_APP_ID, FACEBOOK_APP_SECRET.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { encryptSecret, decryptSecret } from "./crypto";

const APP_ID = process.env.FACEBOOK_APP_ID || "";
const APP_SECRET = process.env.FACEBOOK_APP_SECRET || "";
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
const GRAPH = "https://graph.facebook.com/v21.0";

const REDIRECT_URI = `${BASE_URL.replace(/\/$/, "")}/api/integrations/facebook/callback`;
// "Login do Facebook para Empresas" usa config_id em vez de scope.
const CONFIG_ID = process.env.FACEBOOK_LOGIN_CONFIG_ID || "";

export const FB_SCOPES = ["pages_show_list", "pages_messaging", "pages_manage_metadata", "pages_read_engagement"];

export function assertFacebookConfigured() {
  if (!APP_ID || !APP_SECRET) {
    throw new Error("Facebook OAuth não configurado. Defina FACEBOOK_APP_ID e FACEBOOK_APP_SECRET no .env");
  }
}

export function buildFacebookAuthorizeUrl(state: string): string {
  assertFacebookConfigured();
  const params = new URLSearchParams({
    client_id: APP_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    state,
  });
  if (CONFIG_ID) {
    // Login for Business: permissões/ativos definidos pela configuração.
    params.set("config_id", CONFIG_ID);
  } else {
    // Login clássico: pede permissões por scope.
    params.set("scope", FB_SCOPES.join(","));
  }
  return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
}

/** Troca code por user access token (curto). */
export async function fbExchangeCode(code: string): Promise<string> {
  assertFacebookConfigured();
  const params = new URLSearchParams({
    client_id: APP_ID,
    client_secret: APP_SECRET,
    redirect_uri: REDIRECT_URI,
    code,
  });
  const r = await fetch(`${GRAPH}/oauth/access_token?${params.toString()}`);
  if (!r.ok) throw new Error(`FB code→token falhou: ${r.status} ${await r.text()}`);
  const j: any = await r.json();
  if (!j.access_token) throw new Error("FB sem access_token");
  return j.access_token;
}

/** Troca o user token curto por um long-lived (~60 dias). */
export async function fbLongLivedUserToken(shortToken: string): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: APP_ID,
    client_secret: APP_SECRET,
    fb_exchange_token: shortToken,
  });
  const r = await fetch(`${GRAPH}/oauth/access_token?${params.toString()}`);
  if (!r.ok) throw new Error(`FB long-lived falhou: ${r.status} ${await r.text()}`);
  const j: any = await r.json();
  return j.access_token || shortToken;
}

export interface FbPage {
  id: string;
  name: string;
  access_token: string; // PAGE access token (long-lived se o user token for)
}

/** Lista as Páginas do usuário com os tokens de página. */
export async function fbGetPages(userToken: string): Promise<FbPage[]> {
  const params = new URLSearchParams({ fields: "id,name,access_token", access_token: userToken });
  const r = await fetch(`${GRAPH}/me/accounts?${params.toString()}`);
  if (!r.ok) throw new Error(`FB páginas falhou: ${r.status} ${await r.text()}`);
  const j: any = await r.json();
  return (j.data ?? []).map((p: any) => ({ id: String(p.id), name: p.name, access_token: p.access_token }));
}

/** Diagnóstico: o que o token de usuário enxerga (permissões + páginas). Sem segredo. */
export async function fbDebugInfo(userToken: string): Promise<any> {
  const out: any = {};
  const get = async (path: string) => {
    try {
      const r = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(userToken)}`);
      return await r.json();
    } catch (e: any) {
      return { error: e?.message };
    }
  };
  out.me = await get("me?fields=id,name");
  out.permissions = await get("me/permissions");
  out.accounts = await get("me/accounts?fields=id,name,tasks");
  out.businesses = await get("me/businesses?fields=id,name");
  return out;
}

/** Páginas de um negócio (quando /me/accounts vem vazio — páginas da nova experiência). */
export async function fbGetBusinessPages(userToken: string): Promise<FbPage[]> {
  const biz = await fetch(`${GRAPH}/me/businesses?fields=id&access_token=${encodeURIComponent(userToken)}`)
    .then((r) => r.json()).catch(() => ({ data: [] }));
  const out: FbPage[] = [];
  for (const b of biz.data ?? []) {
    for (const edge of ["owned_pages", "client_pages"]) {
      const r = await fetch(`${GRAPH}/${b.id}/${edge}?fields=id,name,access_token&access_token=${encodeURIComponent(userToken)}`)
        .then((x) => x.json()).catch(() => ({ data: [] }));
      for (const p of r.data ?? []) {
        if (p.access_token && !out.find((x) => x.id === String(p.id))) {
          out.push({ id: String(p.id), name: p.name, access_token: p.access_token });
        }
      }
    }
  }
  return out;
}

/** Assina a Página aos webhooks do app. */
export async function fbSubscribePage(pageId: string, pageToken: string): Promise<{ ok: boolean; body: any }> {
  const params = new URLSearchParams({
    subscribed_fields: "messages,messaging_postbacks",
    access_token: pageToken,
  });
  const r = await fetch(`${GRAPH}/${pageId}/subscribed_apps?${params.toString()}`, { method: "POST" });
  const txt = await r.text();
  let body: any = txt;
  try { body = JSON.parse(txt); } catch { /* texto */ }
  return { ok: r.ok, body };
}

/** Manda DM no Messenger (recipient.id = PSID). Janela de 24h. */
export async function fbSendMessage(pageId: string, psid: string, text: string, pageToken: string): Promise<void> {
  const r = await fetch(`${GRAPH}/${pageId}/messages?access_token=${encodeURIComponent(pageToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: psid }, messaging_type: "RESPONSE", message: { text } }),
  });
  if (!r.ok) throw new Error(`FB send falhou: ${r.status} ${await r.text()}`);
}

/** Nome do participante do Messenger (User Profile API). Best-effort. */
export async function fbGetUserName(psid: string, pageToken: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ fields: "name", access_token: pageToken });
    const r = await fetch(`${GRAPH}/${psid}?${params.toString()}`);
    if (!r.ok) return null;
    const j: any = await r.json();
    return j.name ?? null;
  } catch {
    return null;
  }
}

/** Valida X-Hub-Signature-256 do webhook da Página (chave = App Secret do FB). */
export function verifyFbSignature(rawBody: string, header: string | null): boolean {
  if (!APP_SECRET || !header) return false;
  const expected = "sha256=" + createHmac("sha256", APP_SECRET).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const fbTokenCrypto = {
  encrypt: (s: string) => (s ? encryptSecret(s) : ""),
  decrypt: (s: string | null | undefined) => (s ? decryptSecret(s) : ""),
};

export const facebookConfig = { appId: APP_ID, redirectUri: REDIRECT_URI, graphBase: GRAPH, configId: CONFIG_ID };
