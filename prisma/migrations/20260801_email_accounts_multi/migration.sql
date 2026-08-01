-- Multi-conta de email: substitui CompanyImapConfig (1 por empresa, só IMAP)
-- por EmailAccount (N por empresa, SMTP + IMAP juntos). Feature recém-criada,
-- sem dados em produção — drop simples. Em produção o start.sh aplica via
-- `prisma db push`; este SQL é documental.

DROP TABLE IF EXISTS "CompanyImapConfig";

CREATE TABLE "EmailAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT,
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL DEFAULT 465,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
    "smtpUser" TEXT NOT NULL,
    "smtpPassEnc" TEXT NOT NULL,
    "imapHost" TEXT,
    "imapPort" INTEGER NOT NULL DEFAULT 993,
    "imapSecure" BOOLEAN NOT NULL DEFAULT true,
    "imapUser" TEXT,
    "imapPassEnc" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUid" INTEGER,
    "uidValidity" BIGINT,
    "lastSyncedAt" TIMESTAMP(3),
    "smtpVerified" BOOLEAN NOT NULL DEFAULT false,
    "imapVerified" BOOLEAN NOT NULL DEFAULT false,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailAccount_companyId_idx" ON "EmailAccount"("companyId");

ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- InboxEmail: vínculo com a conta + dedup por conta (não mais por empresa)
ALTER TABLE "InboxEmail" ADD COLUMN "accountId" TEXT;
ALTER TABLE "InboxEmail" ADD CONSTRAINT "InboxEmail_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "InboxEmail_companyId_messageId_key";
CREATE UNIQUE INDEX "InboxEmail_accountId_messageId_key" ON "InboxEmail"("accountId", "messageId");
