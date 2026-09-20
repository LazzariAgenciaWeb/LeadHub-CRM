-- Motivos da suspeita de golpe (links disfarçados, anexos executáveis...).
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

ALTER TABLE "InboxEmail" ADD COLUMN "suspiciousReasons" TEXT[] DEFAULT ARRAY[]::TEXT[];
