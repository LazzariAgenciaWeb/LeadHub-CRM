-- Parâmetros personalizados de eventos GA4 (dimensões customEvent:).
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.
--
-- Objetivo: quebrar eventos de conversão (ex.: whatsapp_click) pelos parâmetros
-- personalizados registrados na propriedade GA4 (ex.: wpp_produto, wpp_codigo,
-- wpp_local), pra dashboard mostrar O QUE gerou cada conversão, não só o total.
-- O sync descobre as dimensões automaticamente via Admin API (customDimensions)
-- e só consulta os eventos marcados como conversão na MarketingEventConfig.

CREATE TABLE "AnalyticsEventParamDaily" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "paramName" TEXT NOT NULL,
    "paramValue" TEXT NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnalyticsEventParamDaily_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AnalyticsEventParamDaily_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AnalyticsEventParamDaily_companyId_date_source_eventName_paramName_paramValue_key"
    ON "AnalyticsEventParamDaily"("companyId", "date", "source", "eventName", "paramName", "paramValue");
CREATE INDEX "AnalyticsEventParamDaily_companyId_date_idx" ON "AnalyticsEventParamDaily"("companyId", "date");
CREATE INDEX "AnalyticsEventParamDaily_companyId_eventName_paramName_idx" ON "AnalyticsEventParamDaily"("companyId", "eventName", "paramName");
