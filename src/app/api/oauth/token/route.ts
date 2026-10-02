import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { corsJson, corsPreflight, pkceMatches, randomToken, sha256, readBody, ACCESS_TOKEN_DAYS, REFRESH_TOKEN_DAYS } from "@/lib/personal-assistant/oauth";

/** Token endpoint: authorization_code (PKCE) e refresh_token (rotativo). */
function err(error: string, description: string, status = 400) {
  return corsJson({ error, error_description: description }, { status });
}

async function issue(clientId: string, userId: string, scope: string | null) {
  const access = randomToken("gohub_oa_");
  const refresh = randomToken("gohub_rt_");
  await prisma.mcpOAuthToken.create({
    data: { tokenHash: sha256(access), refreshHash: sha256(refresh), clientId, userId, scope, expiresAt: new Date(Date.now() + ACCESS_TOKEN_DAYS * 86400_000) },
  });
  return corsJson({
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_DAYS * 86400,
    refresh_token: refresh,
    scope: scope ?? "gohub",
  });
}

export async function POST(req: NextRequest) {
  const b = await readBody(req);
  const grant = b.grant_type;

  if (grant === "authorization_code") {
    if (!b.code) return err("invalid_request", "code obrigatório");
    const row = await prisma.mcpOAuthCode.findUnique({ where: { code: b.code } });
    if (!row) return err("invalid_grant", "code inválido");
    await prisma.mcpOAuthCode.delete({ where: { code: b.code } }).catch(() => {}); // uso único
    if (row.expiresAt < new Date()) return err("invalid_grant", "code expirado");
    if (b.client_id && b.client_id !== row.clientId) return err("invalid_grant", "client_id não confere");
    if (b.redirect_uri && b.redirect_uri !== row.redirectUri) return err("invalid_grant", "redirect_uri não confere");
    if (row.codeChallenge) {
      if (!b.code_verifier || !pkceMatches(b.code_verifier, row.codeChallenge)) return err("invalid_grant", "PKCE inválido");
    }
    return issue(row.clientId, row.userId, row.scope);
  }

  if (grant === "refresh_token") {
    if (!b.refresh_token) return err("invalid_request", "refresh_token obrigatório");
    const row = await prisma.mcpOAuthToken.findUnique({ where: { refreshHash: sha256(b.refresh_token) } });
    if (!row) return err("invalid_grant", "refresh_token inválido");
    if (row.createdAt < new Date(Date.now() - REFRESH_TOKEN_DAYS * 86400_000)) {
      await prisma.mcpOAuthToken.delete({ where: { id: row.id } }).catch(() => {});
      return err("invalid_grant", "refresh_token expirado");
    }
    await prisma.mcpOAuthToken.delete({ where: { id: row.id } }).catch(() => {}); // rotação
    return issue(row.clientId, row.userId, row.scope);
  }

  return err("unsupported_grant_type", "use authorization_code ou refresh_token");
}
export async function OPTIONS() {
  return corsPreflight();
}
