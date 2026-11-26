-- Etapa de projeto concluída (sai da lista ativa e vai pra aba Concluído).
ALTER TABLE "ProjectService" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
