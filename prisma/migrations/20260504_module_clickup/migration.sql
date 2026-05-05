-- Adiciona flag de módulo ClickUp na Company.
-- Quando false (default), a integração com ClickUp fica desligada pra essa empresa:
--   - UI de configuração escondida
--   - Push (criar task / comentário) não dispara
--   - Webhook /api/webhook/clickup/[companyId] retorna 403
--
-- Cada empresa-cliente que quiser usar precisa ligar o módulo + configurar
-- token, list IDs e webhook secret per-empresa.

ALTER TABLE "Company" ADD COLUMN "moduleClickup" BOOLEAN NOT NULL DEFAULT false;
