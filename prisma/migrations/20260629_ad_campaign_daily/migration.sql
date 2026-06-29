-- Ads (Google Ads / Meta Ads) — 1 linha por (empresa, provider, dia, campanha).
-- O enum "IntegrationProvider" já contém GOOGLE_ADS / META_ADS (nenhum ALTER necessário).
CREATE TABLE "AdCampaignDaily" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "date" DATE NOT NULL,
    "externalCampaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "campaignStatus" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "conversions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversionValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCampaignDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdCampaignDaily_companyId_provider_date_externalCampaignId_key" ON "AdCampaignDaily"("companyId", "provider", "date", "externalCampaignId");
CREATE INDEX "AdCampaignDaily_companyId_provider_date_idx" ON "AdCampaignDaily"("companyId", "provider", "date");

ALTER TABLE "AdCampaignDaily" ADD CONSTRAINT "AdCampaignDaily_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
