CREATE TABLE IF NOT EXISTS "LoginHandoff" (
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginHandoff_pkey" PRIMARY KEY ("tokenHash")
);
CREATE INDEX IF NOT EXISTS "LoginHandoff_expiresAt_idx" ON "LoginHandoff"("expiresAt");
