import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAssistantUser } from "@/lib/personal-assistant/session";

/**
 * Token pessoal pra conectar o Claude (MCP) ao GoHub.
 *   POST   → gera (ou regenera) e devolve o token EM TEXTO PURO uma única vez.
 *            Só o hash sha256 fica no banco.
 *   GET    → { hasToken, createdAt, lastUsedAt }
 *   DELETE → revoga.
 */
export async function POST() {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  const raw = `gohub_${crypto.randomBytes(32).toString("base64url")}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  await prisma.user.update({ where: { id: auth.userId }, data: { mcpTokenHash: hash, mcpTokenCreatedAt: new Date(), mcpTokenLastUsedAt: null } });
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  return NextResponse.json({ token: raw, mcpUrl: `${base}/api/mcp` });
}

export async function GET() {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  const u = await prisma.user.findUnique({ where: { id: auth.userId }, select: { mcpTokenHash: true, mcpTokenCreatedAt: true, mcpTokenLastUsedAt: true } });
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  return NextResponse.json({ hasToken: !!u?.mcpTokenHash, createdAt: u?.mcpTokenCreatedAt, lastUsedAt: u?.mcpTokenLastUsedAt, mcpUrl: `${base}/api/mcp` });
}

export async function DELETE() {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  await prisma.user.update({ where: { id: auth.userId }, data: { mcpTokenHash: null, mcpTokenCreatedAt: null, mcpTokenLastUsedAt: null } });
  return NextResponse.json({ ok: true });
}
