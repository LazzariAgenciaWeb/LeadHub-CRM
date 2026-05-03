-- Fase A: regras de pontuação configuráveis por empresa
-- Cada empresa pode habilitar/desabilitar razões, ajustar pontos e decidir
-- se o evento conta pro ranking ou só dá badge.

CREATE TABLE IF NOT EXISTS "ScoreRuleConfig" (
  "id"             TEXT NOT NULL,
  "companyId"      TEXT NOT NULL,
  "reason"         "ScoreReason" NOT NULL,
  "enabled"        BOOLEAN NOT NULL DEFAULT true,
  "points"         INTEGER NOT NULL,
  "affectsRanking" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ScoreRuleConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ScoreRuleConfig_companyId_reason_key"
  ON "ScoreRuleConfig"("companyId", "reason");

CREATE INDEX IF NOT EXISTS "ScoreRuleConfig_companyId_idx"
  ON "ScoreRuleConfig"("companyId");

ALTER TABLE "ScoreRuleConfig"
  ADD CONSTRAINT "ScoreRuleConfig_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fase B: categoria de ranking (Produção vs Gestão)
CREATE TYPE IF NOT EXISTS "RankingCategory" AS ENUM ('PRODUCAO', 'GESTAO');

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "rankingCategory" "RankingCategory" NOT NULL DEFAULT 'PRODUCAO';

-- Marca usuários ADMIN e SUPER_ADMIN como GESTAO automaticamente
UPDATE "User" SET "rankingCategory" = 'GESTAO'
  WHERE "role" IN ('SUPER_ADMIN', 'ADMIN') AND "rankingCategory" = 'PRODUCAO';
