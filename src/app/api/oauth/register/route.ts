import { NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { corsJson, corsPreflight } from "@/lib/personal-assistant/oauth";

/**
 * RFC 7591 — registro dinâmico de cliente. claude.ai chama isto sozinho ao
 * adicionar o conector. Cliente público (PKCE), sem secret.
 */
export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const redirectUris: string[] = Array.isArray(body?.redirect_uris)
    ? body.redirect_uris.filter((u: unknown) => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 10)
    : [];
  if (redirectUris.length === 0) return corsJson({ error: "invalid_redirect_uri", error_description: "redirect_uris obrigatório" }, { status: 400 });

  const id = `gohub-${crypto.randomBytes(12).toString("hex")}`;
  const name = typeof body?.client_name === "string" ? body.client_name.slice(0, 120) : null;
  await prisma.mcpOAuthClient.create({ data: { id, name, redirectUris } });

  return corsJson({
    client_id: id,
    client_name: name ?? undefined,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_id_issued_at: Math.floor(Date.now() / 1000),
  }, { status: 201 });
}
export async function OPTIONS() {
  return corsPreflight();
}
