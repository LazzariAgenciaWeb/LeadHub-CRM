-- AdCreative: guarda os IDs de campanha e conjunto (ad set) da plataforma.
-- Antes só havia o nome, o que obrigava a casar a árvore campanha → conjunto →
-- anúncio por string. Nome muda no gerenciador e quebra o agrupamento.
-- Nulos nas linhas já existentes; o próximo sync do Meta Ads preenche.
ALTER TABLE "AdCreative" ADD COLUMN IF NOT EXISTS "externalCampaignId" TEXT;
ALTER TABLE "AdCreative" ADD COLUMN IF NOT EXISTS "externalAdSetId" TEXT;

CREATE INDEX IF NOT EXISTS "AdCreative_companyId_provider_externalCampaignId_idx"
  ON "AdCreative" ("companyId", "provider", "externalCampaignId");
