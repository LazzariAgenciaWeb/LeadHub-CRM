import crypto from "crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Autentica pelo token pessoal do assistente (Configurações → Meu Perfil).
 * `Authorization: Bearer gohub_...` — só o hash sha256 fica no banco.
 * Usado pelo MCP (/api/mcp) e pelo webhook de entrada (/api/assistente/inbox).
 */
export async function authenticateAssistantToken(req: NextRequest, tokenOverride?: string): Promise<{ userId: string } | null> {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const raw = tokenOverride?.trim() || m?.[1]?.trim() || req.nextUrl.searchParams.get("token")?.trim() || "";
  if (!raw) return null;
  const hash = crypto.createHash("sha256").update(raw).digest("hex");

  // 1) token OAuth (claude.ai conector personalizado)
  if (raw.startsWith("gohub_oa_")) {
    const t = await prisma.mcpOAuthToken.findUnique({ where: { tokenHash: hash }, select: { id: true, userId: true, expiresAt: true } });
    if (!t || t.expiresAt < new Date()) return null;
    prisma.mcpOAuthToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    return { userId: t.userId };
  }

  // 2) token pessoal (Meu Perfil) — Claude Code, webhook, URL /api/mcp/t/<token>
  const user = await prisma.user.findUnique({ where: { mcpTokenHash: hash }, select: { id: true } });
  if (!user) return null;
  prisma.user.update({ where: { id: user.id }, data: { mcpTokenLastUsedAt: new Date() } }).catch(() => {});
  return { userId: user.id };
}
