import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAssistantUser } from "@/lib/personal-assistant/session";
import { hashSecret } from "@/lib/personal-assistant/caldav";

/**
 * Senha dos Lembretes do iPhone (conta CalDAV). Separada do token do Claude:
 * gerar uma não derruba a outra.
 *   POST   → gera (ou regenera) e devolve a senha EM TEXTO PURO uma única vez.
 *   GET    → { hasPassword }
 *   DELETE → desconecta (o iPhone para de sincronizar).
 */
function host() {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXTAUTH_URL ?? "";
  try { return new URL(base).host; } catch { return base.replace(/^https?:\/\//, "").replace(/\/.*$/, ""); }
}

export async function POST() {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  // 4 blocos de 5 (sem caracteres ambíguos) — fácil de colar ou digitar no iPhone.
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const password = Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => abc[crypto.randomInt(abc.length)]).join("")).join("-");
  const u = await prisma.user.update({ where: { id: auth.userId }, data: { caldavPasswordHash: hashSecret(password) }, select: { email: true } });
  return NextResponse.json({ password, server: host(), username: u.email });
}

export async function GET() {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  const u = await prisma.user.findUnique({ where: { id: auth.userId }, select: { caldavPasswordHash: true, email: true } });
  // Últimos pedidos do iPhone (inclui tentativas com senha errada, pelo e-mail usado).
  const atividade = await prisma.caldavRequestLog.findMany({
    where: { OR: [{ userId: auth.userId }, ...(u?.email ? [{ username: { equals: u.email, mode: "insensitive" as const } }] : [])] },
    orderBy: { createdAt: "desc" }, take: 25,
    select: { method: true, path: true, depth: true, status: true, createdAt: true },
  });
  return NextResponse.json({ hasPassword: !!u?.caldavPasswordHash, server: host(), username: u?.email, atividade });
}

export async function DELETE() {
  const auth = await requireAssistantUser();
  if (!auth.ok) return auth.response;
  await prisma.user.update({ where: { id: auth.userId }, data: { caldavPasswordHash: null } });
  return NextResponse.json({ ok: true });
}
