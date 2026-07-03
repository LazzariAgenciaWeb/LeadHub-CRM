-- Outbox/log dos eventos do Meta Conversions API (Fase 3).
-- Grava PENDING antes de enviar; cron reprocessa PENDING/FAILED com backoff.
-- Idempotente por (companyId, eventId). Alimenta a tela de diagnóstico.

CREATE TYPE "MetaConversionStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "MetaConversionLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT,
    "eventName" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "MetaConversionStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "value" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "matchQuality" TEXT,
    "eventsReceived" INTEGER,
    "fbtraceId" TEXT,
    "lastError" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaConversionLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaConversionLog_companyId_eventId_key" ON "MetaConversionLog"("companyId", "eventId");
CREATE INDEX "MetaConversionLog_status_nextRetryAt_idx" ON "MetaConversionLog"("status", "nextRetryAt");
CREATE INDEX "MetaConversionLog_companyId_createdAt_idx" ON "MetaConversionLog"("companyId", "createdAt");

ALTER TABLE "MetaConversionLog" ADD CONSTRAINT "MetaConversionLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
