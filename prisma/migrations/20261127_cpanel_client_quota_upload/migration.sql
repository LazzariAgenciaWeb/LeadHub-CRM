-- Meu Espaço: mudar cota das caixas (com teto) e enviar arquivos pro site.
ALTER TABLE "CpanelIntegration" ADD COLUMN IF NOT EXISTS "clientCanChangeQuota" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CpanelIntegration" ADD COLUMN IF NOT EXISTS "clientMaxQuotaMb" INTEGER;
ALTER TABLE "CpanelIntegration" ADD COLUMN IF NOT EXISTS "clientCanUpload" BOOLEAN NOT NULL DEFAULT false;
