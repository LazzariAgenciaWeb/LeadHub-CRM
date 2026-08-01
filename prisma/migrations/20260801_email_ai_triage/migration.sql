-- Triagem IA da caixa de email: importância + resumo por email.
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

ALTER TABLE "InboxEmail" ADD COLUMN "aiImportance" TEXT;
ALTER TABLE "InboxEmail" ADD COLUMN "aiSummary" TEXT;
