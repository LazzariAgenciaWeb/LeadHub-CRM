-- Aprovação de peças pelo cliente via link + lembretes no grupo do WhatsApp.
ALTER TABLE "SetorClickupList" ADD COLUMN "approvalGroupJid" TEXT;
ALTER TABLE "SetorClickupList" ADD COLUMN "approvalGroupName" TEXT;
ALTER TABLE "SetorClickupList" ADD COLUMN "approvalReminderDays" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "SetorClickupList" ADD COLUMN "approvalMaxReminders" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "ProjectTask" ADD COLUMN "approvalToken" TEXT;
ALTER TABLE "ProjectTask" ADD COLUMN "approvalRound" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProjectTask" ADD COLUMN "approvalCommentAt" TEXT;
ALTER TABLE "ProjectTask" ADD COLUMN "approvalSentAt" TIMESTAMP(3);
ALTER TABLE "ProjectTask" ADD COLUMN "approvalViewedAt" TIMESTAMP(3);
ALTER TABLE "ProjectTask" ADD COLUMN "approvalNudgedAt" TIMESTAMP(3);
ALTER TABLE "ProjectTask" ADD COLUMN "approvalNudgeCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProjectTask" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "ProjectTask" ADD COLUMN "approvedByName" TEXT;
CREATE UNIQUE INDEX "ProjectTask_approvalToken_key" ON "ProjectTask"("approvalToken");
CREATE INDEX "ProjectTask_status_approvalSentAt_idx" ON "ProjectTask"("status", "approvalSentAt");
ALTER TABLE "ProjectTask" ADD COLUMN "approvalFileIds" JSONB;
