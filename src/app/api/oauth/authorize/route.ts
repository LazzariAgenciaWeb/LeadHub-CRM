import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { userCanUseAssistant } from "@/lib/personal-assistant/access";
import { baseUrl, randomToken, CODE_TTL_MIN, readBody } from "@/lib/personal-assistant/oauth";

/**
 * Authorization endpoint (OAuth 2.1 + PKCE).
 *  GET  → valida client/redirect e manda pra tela de consentimento
 *         (/oauth/autorizar). Sem login → /login?callbackUrl=…
 *  POST → vem da tela de consentimento (usuário clicou Autorizar): gera o
 *         code e redireciona pro redirect_uri do claude.ai.
 */
function bad(msg: string) {
  return NextResponse.json({ error: "invalid_request", error_description: msg }, { status: 400 });
}

async function validate(p: URLSearchParams | Record<string, string>) {
  const get = (k: string) => (p instanceof URLSearchParams ? p.get(k) : p[k]) ?? "";
  const clientId = get("client_id"), redirectUri = get("redirect_uri"), state = get("state"), scope = get("scope") || "gohub";
  const challenge = get("code_challenge"), method = get("code_challenge_method") || "S256";
  if (!clientId || !redirectUri) return { error: "client_id e redirect_uri obrigatórios" } as const;
  const client = await prisma.mcpOAuthClient.findUnique({ where: { id: clientId } });
  if (!client) return { error: "client_id desconhecido" } as const;
  if (!client.redirectUris.includes(redirectUri)) return { error: "redirect_uri não registrado" } as const;
  if (challenge && method !== "S256") return { error: "code_challenge_method deve ser S256" } as const;
  return { client, redirectUri, state, scope, challenge } as const;
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if ((p.get("response_type") ?? "code") !== "code") return bad("response_type deve ser code");
  const v = await validate(p);
  if ("error" in v) return bad(String(v.error));

  const session = await getServerSession(authOptions);
  const consentUrl = `${baseUrl()}/oauth/autorizar?${p.toString()}`;
  if (!session) {
    return NextResponse.redirect(`${baseUrl()}/login?callbackUrl=${encodeURIComponent(consentUrl)}`);
  }
  return NextResponse.redirect(consentUrl);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await readBody(req);
  const v = await validate(body);
  if ("error" in v) return bad(String(v.error));

  const back = new URL(v.redirectUri);
  if (body.decision !== "allow") {
    back.searchParams.set("error", "access_denied");
    if (v.state) back.searchParams.set("state", v.state);
    return NextResponse.redirect(back.toString(), { status: 303 });
  }
  if (!(await userCanUseAssistant(userId))) {
    back.searchParams.set("error", "access_denied");
    back.searchParams.set("error_description", "Assistente pessoal não liberado para a sua empresa");
    if (v.state) back.searchParams.set("state", v.state);
    return NextResponse.redirect(back.toString(), { status: 303 });
  }

  const code = randomToken("gc_");
  await prisma.mcpOAuthCode.create({
    data: { code, clientId: v.client.id, userId, redirectUri: v.redirectUri, codeChallenge: v.challenge || null, scope: v.scope, expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60_000) },
  });
  back.searchParams.set("code", code);
  if (v.state) back.searchParams.set("state", v.state);
  return NextResponse.redirect(back.toString(), { status: 303 });
}
