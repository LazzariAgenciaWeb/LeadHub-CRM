-- Pacote grande:
-- 1. Razões pra easter eggs (Coruja/Madrugador/Sortudo/Fênix), SPRINT, sem responsável, bônus mensal
-- 2. Notificação de badge: User.lastBadgeSeenAt
-- 3. Pontos resgatáveis: UserScore.redeemablePoints
-- 4. Sistema de Prêmios: Reward + RewardRedemption
-- 5. Penalidade tarefa sem responsável: SetorClickupList.taskNoAssignee + ProjectTaskState.hasNoAssignee

-- ── ScoreReasons ──
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'STREAK_DIA';
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'BONUS_NOITE';
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'BONUS_MADRUGADA';
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'BONUS_VENDA_RAPIDA';
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'BONUS_RECUPERACAO';
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'TAREFA_SEM_RESPONSAVEL';
ALTER TYPE "ScoreReason" ADD VALUE IF NOT EXISTS 'BONUS_SUPEROU_MES';

-- ── User: timestamp da última notificação vista ──
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "lastBadgeSeenAt" TIMESTAMP(3);

-- ── UserScore: pontos resgatáveis (separados do total histórico) ──
ALTER TABLE "UserScore"
  ADD COLUMN IF NOT EXISTS "redeemablePoints" INTEGER NOT NULL DEFAULT 0;

-- Migra valor existente: redeemable inicia igual ao total (todos podem resgatar)
UPDATE "UserScore" SET "redeemablePoints" = "totalPoints" WHERE "redeemablePoints" = 0;

-- ── Penalidade tarefa sem responsável ──
ALTER TABLE "SetorClickupList"
  ADD COLUMN IF NOT EXISTS "taskNoAssignee" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ProjectTaskState"
  ADD COLUMN IF NOT EXISTS "hasNoAssignee" BOOLEAN NOT NULL DEFAULT false;

-- ── Sistema de Prêmios ──
CREATE TYPE IF NOT EXISTS "RedemptionStatus" AS ENUM (
  'PENDING',     -- aguardando aprovação do admin
  'APPROVED',    -- aprovado, em trânsito
  'DELIVERED',   -- entregue ao colaborador
  'REJECTED'     -- recusado (pontos devolvidos)
);

CREATE TABLE IF NOT EXISTS "Reward" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "cost"        INTEGER NOT NULL,
  "available"   BOOLEAN NOT NULL DEFAULT true,
  "imageUrl"    TEXT,
  "stock"       INTEGER,                    -- null = ilimitado
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Reward_companyId_available_idx" ON "Reward"("companyId", "available");

ALTER TABLE "Reward"
  ADD CONSTRAINT "Reward_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "RewardRedemption" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "companyId"  TEXT NOT NULL,
  "rewardId"   TEXT NOT NULL,
  "rewardName" TEXT NOT NULL,           -- snapshot pra histórico
  "cost"       INTEGER NOT NULL,
  "status"     "RedemptionStatus" NOT NULL DEFAULT 'PENDING',
  "notes"      TEXT,                    -- admin note (motivo de rejeição, etc.)
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),

  CONSTRAINT "RewardRedemption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RewardRedemption_userId_createdAt_idx" ON "RewardRedemption"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "RewardRedemption_companyId_status_idx" ON "RewardRedemption"("companyId", "status");

ALTER TABLE "RewardRedemption"
  ADD CONSTRAINT "RewardRedemption_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RewardRedemption"
  ADD CONSTRAINT "RewardRedemption_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RewardRedemption"
  ADD CONSTRAINT "RewardRedemption_rewardId_fkey"
  FOREIGN KEY ("rewardId") REFERENCES "Reward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
