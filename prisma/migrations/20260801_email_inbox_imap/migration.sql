-- Caixa de Email IMAP (grupo Atender): config IMAP por empresa + emails da caixa.
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

CREATE TYPE "InboxEmailDirection" AS ENUM ('IN', 'OUT');
CREATE TYPE "InboxEmailFolder" AS ENUM ('INBOX', 'IMPORTANT', 'SENT', 'SPAM', 'TRASH');

CREATE TABLE "CompanyImapConfig" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 993,
    "secure" BOOLEAN NOT NULL DEFAULT true,
    "user" TEXT NOT NULL,
    "passEnc" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUid" INTEGER,
    "uidValidity" BIGINT,
    "lastSyncedAt" TIMESTAMP(3),
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyImapConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyImapConfig_companyId_key" ON "CompanyImapConfig"("companyId");

ALTER TABLE "CompanyImapConfig" ADD CONSTRAINT "CompanyImapConfig_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InboxEmail" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "direction" "InboxEmailDirection" NOT NULL,
    "folder" "InboxEmailFolder" NOT NULL DEFAULT 'INBOX',
    "messageId" TEXT,
    "imapUid" INTEGER,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "snippet" TEXT NOT NULL DEFAULT '',
    "textBody" TEXT,
    "htmlBody" TEXT,
    "inReplyTo" TEXT,
    "leadId" TEXT,
    "ticketId" TEXT,
    "seen" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboxEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboxEmail_companyId_messageId_key" ON "InboxEmail"("companyId", "messageId");
CREATE INDEX "InboxEmail_companyId_folder_sentAt_idx" ON "InboxEmail"("companyId", "folder", "sentAt");
CREATE INDEX "InboxEmail_companyId_seen_idx" ON "InboxEmail"("companyId", "seen");
CREATE INDEX "InboxEmail_leadId_idx" ON "InboxEmail"("leadId");
CREATE INDEX "InboxEmail_ticketId_idx" ON "InboxEmail"("ticketId");

ALTER TABLE "InboxEmail" ADD CONSTRAINT "InboxEmail_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboxEmail" ADD CONSTRAINT "InboxEmail_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InboxEmail" ADD CONSTRAINT "InboxEmail_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
