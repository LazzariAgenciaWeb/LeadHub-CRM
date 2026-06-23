-- Módulo Instagram (automação estilo ManyChat).

-- Flag de módulo por empresa.
ALTER TABLE "Company" ADD COLUMN "moduleInstagram" BOOLEAN NOT NULL DEFAULT false;

-- Enums.
CREATE TYPE "IgTriggerType" AS ENUM ('KEYWORD', 'ANY');
CREATE TYPE "IgRunStatus" AS ENUM ('PENDING', 'COMMENT_REPLIED', 'DM_SENT', 'AWAITING_FOLLOW', 'COMPLETED', 'FAILED', 'SKIPPED');
CREATE TYPE "IgFollowState" AS ENUM ('UNKNOWN', 'NOT_FOLLOWING', 'FOLLOWING');

-- Conta IG conectada (token longo 60d cifrado).
CREATE TABLE "InstagramAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT,
    "profilePictureUrl" TEXT,
    "accessTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "InstagramAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstagramAccount_igUserId_key" ON "InstagramAccount"("igUserId");
CREATE INDEX "InstagramAccount_companyId_idx" ON "InstagramAccount"("companyId");
CREATE INDEX "InstagramAccount_status_tokenExpiresAt_idx" ON "InstagramAccount"("status", "tokenExpiresAt");

ALTER TABLE "InstagramAccount" ADD CONSTRAINT "InstagramAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Regra de automação (comentário no post → resposta + DM).
CREATE TABLE "IgAutomation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mediaId" TEXT,
    "mediaLabel" TEXT,
    "triggerType" "IgTriggerType" NOT NULL DEFAULT 'KEYWORD',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "replyToComment" BOOLEAN NOT NULL DEFAULT true,
    "commentReplies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sendDm" BOOLEAN NOT NULL DEFAULT true,
    "dmText" TEXT,
    "dmLinkUrl" TEXT,
    "dmButtonLabel" TEXT,
    "requireFollow" BOOLEAN NOT NULL DEFAULT false,
    "notFollowingText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IgAutomation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IgAutomation_companyId_idx" ON "IgAutomation"("companyId");
CREATE INDEX "IgAutomation_accountId_enabled_idx" ON "IgAutomation"("accountId", "enabled");
CREATE INDEX "IgAutomation_mediaId_idx" ON "IgAutomation"("mediaId");

ALTER TABLE "IgAutomation" ADD CONSTRAINT "IgAutomation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IgAutomation" ADD CONSTRAINT "IgAutomation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Log de cada disparo (idempotência + métricas).
CREATE TABLE "IgAutomationRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "automationId" TEXT,
    "igCommenterId" TEXT NOT NULL,
    "username" TEXT,
    "mediaId" TEXT,
    "commentId" TEXT,
    "commentText" TEXT,
    "status" "IgRunStatus" NOT NULL DEFAULT 'PENDING',
    "followState" "IgFollowState" NOT NULL DEFAULT 'UNKNOWN',
    "errorDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IgAutomationRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IgAutomationRun_automationId_commentId_key" ON "IgAutomationRun"("automationId", "commentId");
CREATE INDEX "IgAutomationRun_companyId_idx" ON "IgAutomationRun"("companyId");
CREATE INDEX "IgAutomationRun_accountId_status_idx" ON "IgAutomationRun"("accountId", "status");
CREATE INDEX "IgAutomationRun_igCommenterId_idx" ON "IgAutomationRun"("igCommenterId");

ALTER TABLE "IgAutomationRun" ADD CONSTRAINT "IgAutomationRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IgAutomationRun" ADD CONSTRAINT "IgAutomationRun_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IgAutomationRun" ADD CONSTRAINT "IgAutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "IgAutomation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
