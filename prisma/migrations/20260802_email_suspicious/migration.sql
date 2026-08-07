-- Flag de suspeita de golpe/phishing (heurística de chegada + triagem IA).
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

ALTER TABLE "InboxEmail" ADD COLUMN "suspicious" BOOLEAN NOT NULL DEFAULT false;
