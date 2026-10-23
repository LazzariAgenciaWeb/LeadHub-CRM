-- Rastreio de abertura do email enviado pela caixa (pixel 1x1 por mensagem).
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

ALTER TABLE "InboxEmail" ADD COLUMN "trackToken"   TEXT;
ALTER TABLE "InboxEmail" ADD COLUMN "openedAt"     TIMESTAMP(3);
ALTER TABLE "InboxEmail" ADD COLUMN "lastOpenedAt" TIMESTAMP(3);
ALTER TABLE "InboxEmail" ADD COLUMN "openCount"    INTEGER NOT NULL DEFAULT 0;

-- Único: o pixel procura o email por este token. NULL não colide com NULL no
-- Postgres, então email sem rastreio (a maioria) convive sem problema.
CREATE UNIQUE INDEX "InboxEmail_trackToken_key" ON "InboxEmail"("trackToken");
