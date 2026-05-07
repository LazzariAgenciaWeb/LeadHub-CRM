-- Default do checkbox "Assinar como X" no compositor de mensagem.
-- true = começa marcado (atual comportamento); user pode desligar pra
-- ter de marcar manual a cada envio.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "whatsappSignatureDefault" BOOLEAN NOT NULL DEFAULT true;
