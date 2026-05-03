-- Sistema de incidentes — admin pode registrar manualmente quando algo dá errado
-- (atendente esqueceu de configurar email do cliente, perdeu prazo crítico, etc.)
-- Gera ScoreEvent com pontos negativos + descrição do que aconteceu.

-- ScoreEvent ganha campos pra suportar incidentes manuais
ALTER TABLE "ScoreEvent"
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "authorId"    TEXT,
  ADD COLUMN IF NOT EXISTS "authorName"  TEXT;

-- Nova razão pra incidentes registrados pelo admin
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'INCIDENTE';
