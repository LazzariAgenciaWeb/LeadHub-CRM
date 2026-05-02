-- 2FA por e-mail para revelar credenciais do cofre.
-- VaultEmailChallenge: códigos OTP enviados por e-mail (hash SHA-256, atempts, expiresAt)
-- VaultTrustedSession: sessão de confiança curta (default 15 min) após validação

CREATE TABLE IF NOT EXISTS "VaultEmailChallenge" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "codeHash"     TEXT NOT NULL,
  "credentialId" TEXT,
  "attempts"     INTEGER NOT NULL DEFAULT 0,
  "used"         BOOLEAN NOT NULL DEFAULT FALSE,
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VaultEmailChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VaultEmailChallenge_userId_expiresAt_idx"
  ON "VaultEmailChallenge"("userId", "expiresAt");

ALTER TABLE "VaultEmailChallenge"
  ADD CONSTRAINT "VaultEmailChallenge_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "VaultTrustedSession" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VaultTrustedSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VaultTrustedSession_userId_expiresAt_idx"
  ON "VaultTrustedSession"("userId", "expiresAt");

ALTER TABLE "VaultTrustedSession"
  ADD CONSTRAINT "VaultTrustedSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
