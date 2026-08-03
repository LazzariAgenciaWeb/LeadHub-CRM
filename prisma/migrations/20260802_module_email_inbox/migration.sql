-- Módulo "Caixa de E-mail" separado do "E-mail Marketing" (toggle por empresa).
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

ALTER TABLE "Company" ADD COLUMN "moduleEmailInbox" BOOLEAN NOT NULL DEFAULT false;

-- Retrocompat: quem já tinha E-mail Marketing ligado mantém a caixa acessível.
-- (db push não roda este UPDATE — em produção, ligar o toggle por empresa OU
-- rodar este comando manualmente uma vez.)
UPDATE "Company" SET "moduleEmailInbox" = true WHERE "moduleEmailMarketing" = true;
