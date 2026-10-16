-- Rascunho de email do compositor da caixa de entrada: salvo sozinho enquanto
-- a pessoa escreve, pra não perder o texto ao sair e voltar.
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

CREATE TABLE "EmailDraft" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId"    TEXT,
  "accountId" TEXT,
  "replyToId" TEXT,
  "toEmail"   TEXT NOT NULL DEFAULT '',
  "ccEmail"   TEXT NOT NULL DEFAULT '',
  "bccEmail"  TEXT NOT NULL DEFAULT '',
  "subject"   TEXT NOT NULL DEFAULT '',
  "textBody"  TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailDraft_companyId_userId_updatedAt_idx"
  ON "EmailDraft"("companyId", "userId", "updatedAt");

ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
