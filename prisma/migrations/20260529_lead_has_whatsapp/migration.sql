-- Validação WhatsApp via Evolution API no fluxo Prospecta IA.
-- NULL  = não validado ainda
-- true  = Evolution confirmou que o número tem WhatsApp ativo
-- false = Evolution confirmou que o número NÃO tem WhatsApp
-- (UI esconde botão "Abrir WhatsApp" quando false)

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "hasWhatsapp" BOOLEAN;
