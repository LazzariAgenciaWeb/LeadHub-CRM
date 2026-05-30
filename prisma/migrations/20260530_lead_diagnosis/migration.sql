-- Diagnóstico IA do prospect: análise de site/Instagram via OpenAI.
-- diagnosis        = JSON estruturado { summary, positives[], opportunities[], criticals[], sourceData{} }
-- diagnosisSource  = "website" | "instagram" | "none" (o que foi efetivamente analisado)
-- diagnosisToken   = UUID público pra rota /d/[token] (link compartilhável)
-- diagnosisClickedAt = 1º clique no link (vira lead automaticamente)

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "diagnosis"          JSONB,
  ADD COLUMN IF NOT EXISTS "diagnosisAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "diagnosisSource"    TEXT,
  ADD COLUMN IF NOT EXISTS "diagnosisToken"     TEXT,
  ADD COLUMN IF NOT EXISTS "diagnosisClickedAt" TIMESTAMP(3);

-- Índice único pro token (lookup rápido em /d/[token]).
-- Permite múltiplos NULLs (Postgres trata NULL como distinto pra unique).
CREATE UNIQUE INDEX IF NOT EXISTS "Lead_diagnosisToken_key" ON "Lead" ("diagnosisToken");
