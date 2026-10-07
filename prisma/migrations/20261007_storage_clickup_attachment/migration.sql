-- Vínculo arquivo ↔ anexo do ClickUp (trazer de lá / enviar pra lá sem duplicar).
ALTER TABLE "StorageObject" ADD COLUMN "clickupAttachmentId" TEXT;
