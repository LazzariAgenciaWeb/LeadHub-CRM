-- Acesso ao sistema passa a ser o padrão para empresa-cliente.
-- Antes, liberar um cliente exigia dois toggles no cadastro (Meu Espaço e
-- sistema completo); quem contratava plano com Marketing/Cofre ainda assim
-- caía só no painel. Os campos continuam existindo como exceção manual.
ALTER TABLE "Company" ALTER COLUMN "hasSystemAccess" SET DEFAULT true;
ALTER TABLE "Company" ALTER COLUMN "fullSystemAccess" SET DEFAULT true;

-- Liga nas empresas já cadastradas.
UPDATE "Company" SET "hasSystemAccess" = true WHERE "hasSystemAccess" = false;
UPDATE "Company" SET "fullSystemAccess" = true WHERE "fullSystemAccess" = false;
