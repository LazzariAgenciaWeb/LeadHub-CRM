-- ─── Sprint 1: Conversation + Activity ──────────────────────────────────────

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'CLOSED');

CREATE TYPE "ActivityType" AS ENUM (
  'STATUS_CHANGED', 'ASSIGNEE_CHANGED', 'SECTOR_CHANGED',
  'STAGE_CHANGED', 'PIPELINE_CHANGED', 'VALUE_CHANGED',
  'NOTE_ADDED', 'CLICKUP_LINKED', 'TRACKING_LINK_SET',
  'LEAD_LINKED', 'CONVERSATION_REOPENED', 'CONVERSATION_CLOSED', 'TRANSFERRED'
);

-- CreateTable: Conversation
CREATE TABLE "Conversation" (
  "id" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "isGroup" BOOLEAN NOT NULL DEFAULT false,
  "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
  "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assigneeId" TEXT,
  "setorId" TEXT,
  "lastMessageAt" TIMESTAMP(3),
  "lastMessageBody" TEXT,
  "lastMessageDirection" "MessageDir",
  "unreadCount" INTEGER NOT NULL DEFAULT 0,
  "firstResponseAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "Conversation_companyId_phone_key" ON "Conversation"("companyId", "phone");
CREATE INDEX "Conversation_companyId_status_idx" ON "Conversation"("companyId", "status");
CREATE INDEX "Conversation_companyId_lastMessageAt_idx" ON "Conversation"("companyId", "lastMessageAt");
CREATE INDEX "Conversation_assigneeId_idx" ON "Conversation"("assigneeId");
CREATE INDEX "Conversation_setorId_idx" ON "Conversation"("setorId");

-- FKs
ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Conversation_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Conversation_setorId_fkey" FOREIGN KEY ("setorId") REFERENCES "Setor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: ConversationNote
CREATE TABLE "ConversationNote" (
  "id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "authorId" TEXT,
  "authorName" TEXT NOT NULL DEFAULT 'Sistema',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "conversationId" TEXT NOT NULL,
  CONSTRAINT "ConversationNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConversationNote_conversationId_idx" ON "ConversationNote"("conversationId");

ALTER TABLE "ConversationNote"
  ADD CONSTRAINT "ConversationNote_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: Activity
CREATE TABLE "Activity" (
  "id" TEXT NOT NULL,
  "type" "ActivityType" NOT NULL,
  "body" TEXT,
  "meta" JSONB,
  "authorId" TEXT,
  "authorName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "conversationId" TEXT,
  "leadId" TEXT,
  "ticketId" TEXT,
  "companyId" TEXT NOT NULL,
  CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Activity_conversationId_createdAt_idx" ON "Activity"("conversationId", "createdAt");
CREATE INDEX "Activity_leadId_createdAt_idx" ON "Activity"("leadId", "createdAt");
CREATE INDEX "Activity_ticketId_createdAt_idx" ON "Activity"("ticketId", "createdAt");
CREATE INDEX "Activity_companyId_createdAt_idx" ON "Activity"("companyId", "createdAt");

ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Activity_leadId_fkey"         FOREIGN KEY ("leadId")         REFERENCES "Lead"("id")         ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Activity_ticketId_fkey"       FOREIGN KEY ("ticketId")       REFERENCES "Ticket"("id")       ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Activity_companyId_fkey"      FOREIGN KEY ("companyId")      REFERENCES "Company"("id")      ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Message — adicionar conversationId
ALTER TABLE "Message" ADD COLUMN "conversationId" TEXT;
CREATE INDEX "Message_conversationId_receivedAt_idx" ON "Message"("conversationId", "receivedAt");
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Lead — adicionar conversationId
ALTER TABLE "Lead" ADD COLUMN "conversationId" TEXT;
CREATE INDEX "Lead_conversationId_idx" ON "Lead"("conversationId");
ALTER TABLE "Lead"
  ADD CONSTRAINT "Lead_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
