-- Origem por link e por gatilho + overrides de UTM no link de rastreio.
-- Tudo nullable: link/gatilho sem origem herda a da campanha (comportamento antigo).
ALTER TABLE "TrackingLink" ADD COLUMN IF NOT EXISTS "source"      TEXT;
ALTER TABLE "TrackingLink" ADD COLUMN IF NOT EXISTS "utmSource"   TEXT;
ALTER TABLE "TrackingLink" ADD COLUMN IF NOT EXISTS "utmMedium"   TEXT;
ALTER TABLE "TrackingLink" ADD COLUMN IF NOT EXISTS "utmCampaign" TEXT;
ALTER TABLE "TrackingLink" ADD COLUMN IF NOT EXISTS "utmTerm"     TEXT;

ALTER TABLE "KeywordRule" ADD COLUMN IF NOT EXISTS "source" TEXT;
