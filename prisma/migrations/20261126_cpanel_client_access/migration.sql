-- Meu Espaço: o que o cliente pode fazer com os e-mails da hospedagem dele.
-- Aditivo, padrão desligado.
ALTER TABLE "CpanelIntegration" ADD COLUMN IF NOT EXISTS "clientCanManageEmail" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CpanelIntegration" ADD COLUMN IF NOT EXISTS "clientCanCreateEmail" BOOLEAN NOT NULL DEFAULT false;
