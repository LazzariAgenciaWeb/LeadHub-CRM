/**
 * 2FA por e-mail para o cofre.
 *
 * Fluxo:
 *  1. Usuário clica "Mostrar senha" → frontend chama /api/vault/challenge
 *  2. Backend gera código de 6 dígitos, salva HASH no banco, envia email
 *  3. Usuário digita código → frontend chama /api/vault/verify
 *  4. Backend valida (hash + expiresAt + tentativas), cria VaultTrustedSession
 *  5. Próximas chamadas a /reveal validam pela trusted session (15 min)
 *
 * Não armazenamos o código em texto claro — só o hash SHA-256.
 */

import { createHash, randomInt } from "crypto";
import { prisma } from "./prisma";

const CODE_TTL_MIN = 5;             // validade do código
const CHALLENGE_MAX_ATTEMPTS = 5;   // tentativas erradas antes de invalidar
const TRUSTED_TTL_MIN = 15;         // duração da sessão de confiança

export function generateCode(): string {
  // 6 dígitos com leading zeros
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export interface CreateChallengeResult {
  challengeId: string;
  code: string;       // texto claro — só usado pra mandar email IMEDIATAMENTE
  expiresAt: Date;
}

export async function createChallenge(opts: {
  userId: string;
  credentialId?: string;
}): Promise<CreateChallengeResult> {
  // Invalida challenges anteriores não usados do mesmo usuário pra não confundir
  await prisma.vaultEmailChallenge.updateMany({
    where: { userId: opts.userId, used: false, expiresAt: { gt: new Date() } },
    data: { used: true },
  });

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60_000);
  const challenge = await prisma.vaultEmailChallenge.create({
    data: {
      userId: opts.userId,
      codeHash: hashCode(code),
      credentialId: opts.credentialId ?? null,
      expiresAt,
    },
    select: { id: true },
  });
  return { challengeId: challenge.id, code, expiresAt };
}

export type VerifyResult =
  | { ok: true; trustedUntil: Date }
  | { ok: false; reason: "EXPIRED" | "INVALID" | "USED" | "TOO_MANY_ATTEMPTS" | "NOT_FOUND" };

export async function verifyChallenge(opts: {
  userId: string;
  challengeId: string;
  code: string;
}): Promise<VerifyResult> {
  const ch = await prisma.vaultEmailChallenge.findUnique({
    where: { id: opts.challengeId },
  });
  if (!ch) return { ok: false, reason: "NOT_FOUND" };
  if (ch.userId !== opts.userId) return { ok: false, reason: "NOT_FOUND" };
  if (ch.used) return { ok: false, reason: "USED" };
  if (ch.expiresAt < new Date()) return { ok: false, reason: "EXPIRED" };
  if (ch.attempts >= CHALLENGE_MAX_ATTEMPTS) return { ok: false, reason: "TOO_MANY_ATTEMPTS" };

  if (hashCode(opts.code) !== ch.codeHash) {
    await prisma.vaultEmailChallenge.update({
      where: { id: ch.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, reason: "INVALID" };
  }

  // Sucesso: marca challenge como usado e cria trusted session
  const trustedUntil = new Date(Date.now() + TRUSTED_TTL_MIN * 60_000);
  await prisma.$transaction([
    prisma.vaultEmailChallenge.update({
      where: { id: ch.id },
      data: { used: true },
    }),
    prisma.vaultTrustedSession.create({
      data: { userId: opts.userId, expiresAt: trustedUntil },
    }),
  ]);

  return { ok: true, trustedUntil };
}

/**
 * Verifica se o usuário tem trusted session ativa.
 * Devolve a data de expiração se houver, senão null.
 */
export async function getActiveTrustedSession(userId: string): Promise<Date | null> {
  const sess = await prisma.vaultTrustedSession.findFirst({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { expiresAt: "desc" },
    select: { expiresAt: true },
  });
  return sess?.expiresAt ?? null;
}

/** Limpa sessões expiradas — chamar opcionalmente em cron. */
export async function cleanupExpired(): Promise<{ challenges: number; sessions: number }> {
  const now = new Date();
  const [c, s] = await Promise.all([
    prisma.vaultEmailChallenge.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.vaultTrustedSession.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  return { challenges: c.count, sessions: s.count };
}

export const VAULT_2FA_CONFIG = {
  CODE_TTL_MIN,
  CHALLENGE_MAX_ATTEMPTS,
  TRUSTED_TTL_MIN,
};
