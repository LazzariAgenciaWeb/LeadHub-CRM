-- Correção manual da triagem (gaveta escolhida pelo usuário; IA não sobrescreve).
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

ALTER TABLE "InboxEmail" ADD COLUMN "aiLocked" BOOLEAN NOT NULL DEFAULT false;
