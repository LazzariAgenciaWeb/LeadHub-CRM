-- Permissão de setor "Ver E-mail" (Caixa de E-mail). Default true segue o
-- padrão das permissões de módulo (empresa que liga o módulo distribui acesso;
-- admin restringe setor a setor).
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

ALTER TABLE "Setor" ADD COLUMN "canViewEmail" BOOLEAN NOT NULL DEFAULT true;
