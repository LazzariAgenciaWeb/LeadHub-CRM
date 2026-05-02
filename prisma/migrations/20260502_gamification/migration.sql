-- Gamificação: UserScore, UserBadge, ScoreEvent
-- UserScore: pontuação mensal e total por usuário
-- UserBadge: badges conquistadas (com nível)
-- ScoreEvent: histórico de cada ponto ganho/perdido (feed de eventos)

CREATE TYPE IF NOT EXISTS "BadgeType" AS ENUM (
  'RAIO_VELOZ',
  'SPRINT_MASTER',
  'PRIMEIRO_DO_DIA',
  'RESOLVEDOR',
  'ZERO_PENDENCIA',
  'ANTECIPADOR',
  'CLOSER',
  'FUNIL_COMPLETO',
  'REI_DO_MES'
);

CREATE TYPE IF NOT EXISTS "BadgeLevel" AS ENUM ('BRONZE', 'PRATA', 'OURO');

CREATE TYPE IF NOT EXISTS "ScoreReason" AS ENUM (
  'RESPOSTA_RAPIDA_5MIN',
  'RESPOSTA_RAPIDA_30MIN',
  'TICKET_RESOLVIDO',
  'LEAD_AVANCADO',
  'LEAD_CONVERTIDO',
  'DIA_SEM_PENDENCIA',
  'RETORNO_ANTECIPADO',
  'ATENDIMENTO_MESMO_DIA',
  'NOTA_REGISTRADA',
  'SLA_VENCIDO',
  'CONVERSA_SEM_RESPOSTA'
);

-- Pontuação agregada por usuário × mês × ano
CREATE TABLE IF NOT EXISTS "UserScore" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "totalPoints" INTEGER NOT NULL DEFAULT 0,   -- acumulado histórico (nunca zera)
  "monthPoints" INTEGER NOT NULL DEFAULT 0,   -- do mês corrente (reseta dia 1)
  "month"       INTEGER NOT NULL,             -- 1-12
  "year"        INTEGER NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserScore_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserScore_userId_month_year_key"
  ON "UserScore"("userId", "month", "year");

CREATE INDEX IF NOT EXISTS "UserScore_companyId_month_year_idx"
  ON "UserScore"("companyId", "month", "year");

CREATE INDEX IF NOT EXISTS "UserScore_userId_idx"
  ON "UserScore"("userId");

ALTER TABLE "UserScore"
  ADD CONSTRAINT "UserScore_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserScore"
  ADD CONSTRAINT "UserScore_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Badges conquistadas por usuário
CREATE TABLE IF NOT EXISTS "UserBadge" (
  "id"       TEXT NOT NULL,
  "userId"   TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "badge"    "BadgeType" NOT NULL,
  "level"    "BadgeLevel" NOT NULL DEFAULT 'BRONZE',
  "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserBadge_userId_badge_level_key"
  ON "UserBadge"("userId", "badge", "level");

CREATE INDEX IF NOT EXISTS "UserBadge_userId_idx"
  ON "UserBadge"("userId");

CREATE INDEX IF NOT EXISTS "UserBadge_companyId_idx"
  ON "UserBadge"("companyId");

ALTER TABLE "UserBadge"
  ADD CONSTRAINT "UserBadge_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserBadge"
  ADD CONSTRAINT "UserBadge_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Feed de eventos de pontuação (cada +/- com motivo e referência)
CREATE TABLE IF NOT EXISTS "ScoreEvent" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "points"      INTEGER NOT NULL,
  "reason"      "ScoreReason" NOT NULL,
  "referenceId" TEXT,              -- id da conversa, ticket ou lead que gerou o evento
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ScoreEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ScoreEvent_userId_createdAt_idx"
  ON "ScoreEvent"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "ScoreEvent_companyId_createdAt_idx"
  ON "ScoreEvent"("companyId", "createdAt");

ALTER TABLE "ScoreEvent"
  ADD CONSTRAINT "ScoreEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScoreEvent"
  ADD CONSTRAINT "ScoreEvent_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Módulo de gamificação no feature flag da empresa
ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "moduleGamificacao" BOOLEAN NOT NULL DEFAULT false;
