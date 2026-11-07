import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

// Código de entrada de uso único (ver model LoginHandoff). Só o hash vai pro
// banco; o código em si viaja no #fragmento da URL, que não chega em log de
// servidor nem em Referer.

const TTL_MS = 2 * 60_000;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createLoginHandoff(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.loginHandoff.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } } }).catch(() => {});
  await prisma.loginHandoff.create({
    data: { tokenHash: hash(token), userId, expiresAt: new Date(Date.now() + TTL_MS) },
  });
  return token;
}

/** Troca o código pelo usuário. Atômico: o segundo uso (ou depois de vencer) dá null. */
export async function consumeLoginHandoff(token: string): Promise<string | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const tokenHash = hash(token);
  const now = new Date();
  const { count } = await prisma.loginHandoff.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (count !== 1) return null;
  const row = await prisma.loginHandoff.findUnique({ where: { tokenHash }, select: { userId: true } });
  return row?.userId ?? null;
}
