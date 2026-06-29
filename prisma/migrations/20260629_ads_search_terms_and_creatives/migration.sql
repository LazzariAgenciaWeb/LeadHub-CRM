-- Breakdowns do Google Ads: termos de pesquisa + conteúdo/métricas de anúncio.
CREATE TABLE "AdSearchTermDaily" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "date" DATE NOT NULL,
    "searchTerm" TEXT NOT NULL,
    "adGroupId" TEXT NOT NULL DEFAULT '',
    "adGroupName" TEXT,
    "campaignName" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "conversions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversionValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdSearchTermDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdSearchTermDaily_companyId_provider_date_searchTerm_adGroup_key" ON "AdSearchTermDaily"("companyId", "provider", "date", "searchTerm", "adGroupId");
CREATE INDEX "AdSearchTermDaily_companyId_provider_date_idx" ON "AdSearchTermDaily"("companyId", "provider", "date");
ALTER TABLE "AdSearchTermDaily" ADD CONSTRAINT "AdSearchTermDaily_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AdCreative" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "externalAdId" TEXT NOT NULL,
    "campaignName" TEXT,
    "adGroupName" TEXT,
    "adType" TEXT,
    "status" TEXT,
    "headlines" JSONB,
    "descriptions" JSONB,
    "finalUrl" TEXT,
    "path1" TEXT,
    "path2" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdCreative_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdCreative_companyId_provider_externalAdId_key" ON "AdCreative"("companyId", "provider", "externalAdId");
CREATE INDEX "AdCreative_companyId_provider_idx" ON "AdCreative"("companyId", "provider");
ALTER TABLE "AdCreative" ADD CONSTRAINT "AdCreative_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AdCreativeDaily" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "date" DATE NOT NULL,
    "externalAdId" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "conversions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversionValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdCreativeDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdCreativeDaily_companyId_provider_date_externalAdId_key" ON "AdCreativeDaily"("companyId", "provider", "date", "externalAdId");
CREATE INDEX "AdCreativeDaily_companyId_provider_date_idx" ON "AdCreativeDaily"("companyId", "provider", "date");
ALTER TABLE "AdCreativeDaily" ADD CONSTRAINT "AdCreativeDaily_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
