-- Toggle da triagem IA automática da caixa de email (default OFF — economiza
-- a cota de interações de IA da empresa; o Resumo IA manual segue disponível).
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

ALTER TABLE "Company" ADD COLUMN "emailAiTriageAuto" BOOLEAN NOT NULL DEFAULT false;
