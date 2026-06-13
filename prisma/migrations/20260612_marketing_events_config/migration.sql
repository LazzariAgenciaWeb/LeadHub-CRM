-- Eventos GA4 por dia (padrão + personalizados). Uma linha por (empresa, dia, source, nome do evento).
CREATE TABLE "AnalyticsEventDaily" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsEventDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalyticsEventDaily_companyId_date_source_eventName_key" ON "AnalyticsEventDaily"("companyId", "date", "source", "eventName");
CREATE INDEX "AnalyticsEventDaily_companyId_date_idx" ON "AnalyticsEventDaily"("companyId", "date");
CREATE INDEX "AnalyticsEventDaily_companyId_eventName_idx" ON "AnalyticsEventDaily"("companyId", "eventName");

ALTER TABLE "AnalyticsEventDaily" ADD CONSTRAINT "AnalyticsEventDaily_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Configuração por empresa: qual evento conta como conversão, rótulo amigável, ocultar.
CREATE TABLE "MarketingEventConfig" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "isConversion" BOOLEAN NOT NULL DEFAULT false,
    "displayLabel" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingEventConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketingEventConfig_companyId_source_eventName_key" ON "MarketingEventConfig"("companyId", "source", "eventName");
CREATE INDEX "MarketingEventConfig_companyId_idx" ON "MarketingEventConfig"("companyId");

ALTER TABLE "MarketingEventConfig" ADD CONSTRAINT "MarketingEventConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
