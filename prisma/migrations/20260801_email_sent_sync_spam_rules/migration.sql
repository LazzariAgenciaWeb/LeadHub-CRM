-- Sync da pasta Enviados do servidor (\Sent), blacklist/whitelist de
-- remetentes e pasta "Resolvidos" (ARCHIVE).
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

ALTER TABLE "EmailAccount" ADD COLUMN "sentLastUid" INTEGER;
ALTER TABLE "EmailAccount" ADD COLUMN "sentUidValidity" BIGINT;

ALTER TYPE "InboxEmailFolder" ADD VALUE 'ARCHIVE' BEFORE 'SPAM';

CREATE TYPE "InboxSenderRuleType" AS ENUM ('BLOCK', 'ALLOW');

CREATE TABLE "InboxSenderRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "type" "InboxSenderRuleType" NOT NULL DEFAULT 'BLOCK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboxSenderRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboxSenderRule_companyId_fromEmail_key" ON "InboxSenderRule"("companyId", "fromEmail");

ALTER TABLE "InboxSenderRule" ADD CONSTRAINT "InboxSenderRule_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
