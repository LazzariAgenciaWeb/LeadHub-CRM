-- Descarte/golpe vão direto pro Spam em vez de ficar na Entrada.
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

ALTER TABLE "Company" ADD COLUMN "emailAutoSpam" BOOLEAN NOT NULL DEFAULT false;
