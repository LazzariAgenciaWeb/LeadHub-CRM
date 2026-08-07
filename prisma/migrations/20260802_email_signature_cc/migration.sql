-- Assinatura por conta + Cc/Cco nos emails enviados.
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

ALTER TABLE "EmailAccount" ADD COLUMN "signature" TEXT;
ALTER TABLE "InboxEmail" ADD COLUMN "ccEmail" TEXT;
ALTER TABLE "InboxEmail" ADD COLUMN "bccEmail" TEXT;
