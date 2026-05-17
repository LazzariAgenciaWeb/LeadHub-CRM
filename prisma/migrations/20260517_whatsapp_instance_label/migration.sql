-- Nome amigável da instância WhatsApp (rótulo que o usuário digita e vê).
-- instanceName passa a ser o slug técnico auto-gerado usado na Evolution API.
-- Aditivo e nullable — instâncias antigas usam instanceName como fallback na UI.

ALTER TABLE "WhatsappInstance" ADD COLUMN "label" TEXT;
