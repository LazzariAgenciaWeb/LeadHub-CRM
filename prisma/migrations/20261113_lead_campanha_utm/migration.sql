-- UTMs crus da conversão no lead.
-- A campanha do lead continua sendo a relação com Campaign (Lead.campaignId) —
-- é ela que dá contagem de leads por campanha. Estas colunas guardam o que a
-- landing/anúncio mandou de verdade, sem tradução: servem para auditar a
-- atribuição (anúncio e criativo exatos) e para não perder a grafia original
-- quando o utm_campaign não casa com nenhuma campanha cadastrada.
-- Tudo nullable: lead antigo e lead de origem manual seguem sem UTM.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "utmSource"   TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "utmMedium"   TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "utmCampaign" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "utmContent"  TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "utmTerm"     TEXT;
