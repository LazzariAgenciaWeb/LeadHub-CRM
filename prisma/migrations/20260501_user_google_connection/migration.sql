-- Conexão OAuth por usuário com serviços pessoais do Google (Calendar etc.).
-- Cada atendente liga a própria conta para que o calendário pessoal apareça
-- na vista Meu Dia. Tokens criptografados via AES-256-GCM (src/lib/crypto.ts).

CREATE TABLE IF NOT EXISTS "UserGoogleConnection" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "service"         TEXT NOT NULL,
  "googleEmail"     TEXT,
  "googleName"      TEXT,
  "accessTokenEnc"  TEXT,
  "refreshTokenEnc" TEXT,
  "tokenExpiresAt"  TIMESTAMP(3),
  "scopes"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status"          TEXT NOT NULL DEFAULT 'ACTIVE',
  "lastError"       TEXT,
  "lastSyncAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserGoogleConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserGoogleConnection_userId_service_key"
  ON "UserGoogleConnection"("userId", "service");

CREATE INDEX IF NOT EXISTS "UserGoogleConnection_userId_idx"
  ON "UserGoogleConnection"("userId");

ALTER TABLE "UserGoogleConnection"
  ADD CONSTRAINT "UserGoogleConnection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
