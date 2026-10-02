import crypto from "crypto";
import { NextResponse } from "next/server";

/**
 * Helpers do servidor OAuth 2.1 mínimo pro MCP (claude.ai conector
 * personalizado). Só o que o MCP pede: registro dinâmico, authorization code
 * com PKCE S256, refresh token. Tokens guardados como hash sha256.
 */
export const ACCESS_TOKEN_DAYS = 30;
export const REFRESH_TOKEN_DAYS = 90;
export const CODE_TTL_MIN = 10;

export function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
}
export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
export function randomToken(prefix: string): string {
  return `${prefix}${crypto.randomBytes(32).toString("base64url")}`;
}
export function pkceMatches(verifier: string, challenge: string): boolean {
  const calc = crypto.createHash("sha256").update(verifier).digest("base64url");
  return calc === challenge;
}

/** CORS liberado: o claude.ai chama metadata/register/token do backend dele e do browser. */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};
export function corsJson(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return NextResponse.json(body, { status: init?.status ?? 200, headers: { ...CORS_HEADERS, ...(init?.headers ?? {}) } });
}
export function corsPreflight() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export function authorizationServerMetadata() {
  const b = baseUrl();
  return {
    issuer: b,
    authorization_endpoint: `${b}/api/oauth/authorize`,
    token_endpoint: `${b}/api/oauth/token`,
    registration_endpoint: `${b}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: ["gohub"],
  };
}
export function protectedResourceMetadata() {
  const b = baseUrl();
  return {
    resource: `${b}/api/mcp`,
    authorization_servers: [b],
    scopes_supported: ["gohub"],
    bearer_methods_supported: ["header"],
  };
}

/** Lê o body como JSON ou form-urlencoded (clientes OAuth usam os dois). */
export async function readBody(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try { const j = await req.json(); return typeof j === "object" && j ? j : {}; } catch { return {}; }
  }
  try {
    const text = await req.text();
    const out: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(text)) out[k] = v;
    return out;
  } catch { return {}; }
}
