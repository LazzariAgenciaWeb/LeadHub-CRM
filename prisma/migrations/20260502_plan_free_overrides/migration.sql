-- Adiciona valor FREE no enum PlanTier
ALTER TYPE "PlanTier" ADD VALUE IF NOT EXISTS 'FREE' BEFORE 'TRIAL';

-- Adiciona colunas de override por cliente em Subscription
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "customLimits" JSONB;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "customFeatures" JSONB;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "customNotes" TEXT;
