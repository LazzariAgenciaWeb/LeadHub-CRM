-- Adiciona flags de módulo Campanhas + Links em Company.
-- Permite gate efetivo no Sidebar (ligado pelo plano + customFeatures via
-- sync no PATCH de Subscription).

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "moduleCampanhas" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "moduleLinks"     BOOLEAN NOT NULL DEFAULT false;
