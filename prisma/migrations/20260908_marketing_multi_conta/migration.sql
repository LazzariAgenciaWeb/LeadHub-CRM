-- Múltiplas contas Google por empresa (GA4 / Search Console / Meu Negócio).
--
-- Antes, toda tabela de dados era chaveada só por companyId. Empresa com duas
-- propriedades GA4 tinha uma sobrescrevendo a outra no upsert, e cada sync
-- rodava deleteMany por companyId — apagando o que a outra acabara de gravar.
--
-- Agora cada linha carrega o MarketingIntegration.id que a gerou. O sentinela
-- 'legacy' cobre (a) linhas anteriores a esta migração e (b) linhas de conexões
-- já desconectadas; o backfill em /api/admin/backfill-integration-id troca
-- 'legacy' pelo id real onde há uma única conexão daquele provider na empresa.
--
-- Os novos @@unique são SUPERCONJUNTOS dos antigos (só ganharam uma coluna),
-- então trocar o índice nunca esbarra em duplicata pré-existente.

-- ─── GA4 ─────────────────────────────────────────────────────────────────────

ALTER TABLE "AnalyticsSnapshot"      ADD COLUMN "integrationId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "AnalyticsTopPage"       ADD COLUMN "integrationId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "AnalyticsTrafficSource" ADD COLUMN "integrationId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "AnalyticsGeoData"       ADD COLUMN "integrationId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "AnalyticsEventDaily"    ADD COLUMN "integrationId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "AnalyticsEventParamDaily" ADD COLUMN "integrationId" TEXT NOT NULL DEFAULT 'legacy';

DROP INDEX IF EXISTS "AnalyticsSnapshot_companyId_date_source_key";
CREATE UNIQUE INDEX "AnalyticsSnapshot_companyId_integrationId_date_source_key"
  ON "AnalyticsSnapshot" ("companyId", "integrationId", "date", "source");
CREATE INDEX "AnalyticsSnapshot_integrationId_date_idx" ON "AnalyticsSnapshot" ("integrationId", "date");

DROP INDEX IF EXISTS "AnalyticsTopPage_companyId_date_source_pagePath_key";
CREATE UNIQUE INDEX "AnalyticsTopPage_companyId_integrationId_date_source_pagePa_key"
  ON "AnalyticsTopPage" ("companyId", "integrationId", "date", "source", "pagePath");
CREATE INDEX "AnalyticsTopPage_integrationId_date_idx" ON "AnalyticsTopPage" ("integrationId", "date");

DROP INDEX IF EXISTS "AnalyticsTrafficSource_companyId_date_source_rawSource_rawMedium_key";
CREATE UNIQUE INDEX "AnalyticsTrafficSource_companyId_integrationId_date_source__key"
  ON "AnalyticsTrafficSource" ("companyId", "integrationId", "date", "source", "rawSource", "rawMedium");
CREATE INDEX "AnalyticsTrafficSource_integrationId_date_idx" ON "AnalyticsTrafficSource" ("integrationId", "date");

DROP INDEX IF EXISTS "AnalyticsGeoData_companyId_date_source_countryCode_region_city_key";
CREATE UNIQUE INDEX "AnalyticsGeoData_companyId_integrationId_date_source_countr_key"
  ON "AnalyticsGeoData" ("companyId", "integrationId", "date", "source", "countryCode", "region", "city");
CREATE INDEX "AnalyticsGeoData_integrationId_date_idx" ON "AnalyticsGeoData" ("integrationId", "date");

DROP INDEX IF EXISTS "AnalyticsEventDaily_companyId_date_source_eventName_key";
CREATE UNIQUE INDEX "AnalyticsEventDaily_companyId_integrationId_date_source_eve_key"
  ON "AnalyticsEventDaily" ("companyId", "integrationId", "date", "source", "eventName");
CREATE INDEX "AnalyticsEventDaily_integrationId_date_idx" ON "AnalyticsEventDaily" ("integrationId", "date");

DROP INDEX IF EXISTS "AnalyticsEventParamDaily_companyId_date_source_eventName_paramName_paramValue_key";
CREATE UNIQUE INDEX "AnalyticsEventParamDaily_companyId_integrationId_date_sourc_key"
  ON "AnalyticsEventParamDaily" ("companyId", "integrationId", "date", "source", "eventName", "paramName", "paramValue");
CREATE INDEX "AnalyticsEventParamDaily_integrationId_date_idx" ON "AnalyticsEventParamDaily" ("integrationId", "date");

-- ─── Search Console ──────────────────────────────────────────────────────────

ALTER TABLE "SearchConsoleQuery" ADD COLUMN "integrationId" TEXT NOT NULL DEFAULT 'legacy';

DROP INDEX IF EXISTS "SearchConsoleQuery_companyId_date_query_page_country_device_key";
CREATE UNIQUE INDEX "SearchConsoleQuery_companyId_integrationId_date_query_page__key"
  ON "SearchConsoleQuery" ("companyId", "integrationId", "date", "query", "page", "country", "device");
CREATE INDEX "SearchConsoleQuery_integrationId_date_idx" ON "SearchConsoleQuery" ("integrationId", "date");

-- ─── Google Meu Negócio ──────────────────────────────────────────────────────

ALTER TABLE "GbpInsight"         ADD COLUMN "integrationId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "GbpReview"          ADD COLUMN "integrationId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "GbpSearchKeyword"   ADD COLUMN "integrationId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "GbpProfileSnapshot" ADD COLUMN "integrationId" TEXT NOT NULL DEFAULT 'legacy';

DROP INDEX IF EXISTS "GbpInsight_companyId_date_key";
CREATE UNIQUE INDEX "GbpInsight_companyId_integrationId_date_key"
  ON "GbpInsight" ("companyId", "integrationId", "date");
CREATE INDEX "GbpInsight_integrationId_date_idx" ON "GbpInsight" ("integrationId", "date");

CREATE INDEX "GbpReview_integrationId_createTime_idx" ON "GbpReview" ("integrationId", "createTime");

DROP INDEX IF EXISTS "GbpSearchKeyword_companyId_year_month_keyword_key";
CREATE UNIQUE INDEX "GbpSearchKeyword_companyId_integrationId_year_month_keyword_key"
  ON "GbpSearchKeyword" ("companyId", "integrationId", "year", "month", "keyword");
CREATE INDEX "GbpSearchKeyword_integrationId_year_month_idx" ON "GbpSearchKeyword" ("integrationId", "year", "month");

CREATE INDEX "GbpProfileSnapshot_integrationId_syncedAt_idx" ON "GbpProfileSnapshot" ("integrationId", "syncedAt");

-- ─── Apelido da conexão ──────────────────────────────────────────────────────
-- O nome que a Google devolve costuma ser idêntico entre duas propriedades da
-- mesma empresa; o apelido é o que aparece no seletor do relatório.
ALTER TABLE "MarketingIntegration" ADD COLUMN "nickname" TEXT;

-- ─── Backfill ────────────────────────────────────────────────────────────────
-- Onde a empresa tem UMA única conexão do provider, todo o histórico é dela.
-- Empresa com mais de uma (ou nenhuma) fica em 'legacy' e o endpoint
-- /api/admin/backfill-integration-id resolve com a mesma regra — este bloco é
-- só pra quem roda `prisma migrate` local; o deploy usa `db push` + endpoint.

WITH solo AS (
  SELECT "companyId", MIN("id") AS "integrationId"
    FROM "MarketingIntegration"
   WHERE "provider" = 'GA4' AND "accountId" IS NOT NULL
   GROUP BY "companyId"
  HAVING COUNT(*) = 1
)
UPDATE "AnalyticsSnapshot" t SET "integrationId" = s."integrationId"
  FROM solo s WHERE t."companyId" = s."companyId" AND t."integrationId" = 'legacy';

WITH solo AS (
  SELECT "companyId", MIN("id") AS "integrationId"
    FROM "MarketingIntegration"
   WHERE "provider" = 'GA4' AND "accountId" IS NOT NULL
   GROUP BY "companyId" HAVING COUNT(*) = 1
)
UPDATE "AnalyticsTopPage" t SET "integrationId" = s."integrationId"
  FROM solo s WHERE t."companyId" = s."companyId" AND t."integrationId" = 'legacy';

WITH solo AS (
  SELECT "companyId", MIN("id") AS "integrationId"
    FROM "MarketingIntegration"
   WHERE "provider" = 'GA4' AND "accountId" IS NOT NULL
   GROUP BY "companyId" HAVING COUNT(*) = 1
)
UPDATE "AnalyticsTrafficSource" t SET "integrationId" = s."integrationId"
  FROM solo s WHERE t."companyId" = s."companyId" AND t."integrationId" = 'legacy';

WITH solo AS (
  SELECT "companyId", MIN("id") AS "integrationId"
    FROM "MarketingIntegration"
   WHERE "provider" = 'GA4' AND "accountId" IS NOT NULL
   GROUP BY "companyId" HAVING COUNT(*) = 1
)
UPDATE "AnalyticsGeoData" t SET "integrationId" = s."integrationId"
  FROM solo s WHERE t."companyId" = s."companyId" AND t."integrationId" = 'legacy';

WITH solo AS (
  SELECT "companyId", MIN("id") AS "integrationId"
    FROM "MarketingIntegration"
   WHERE "provider" = 'GA4' AND "accountId" IS NOT NULL
   GROUP BY "companyId" HAVING COUNT(*) = 1
)
UPDATE "AnalyticsEventDaily" t SET "integrationId" = s."integrationId"
  FROM solo s WHERE t."companyId" = s."companyId" AND t."integrationId" = 'legacy';

WITH solo AS (
  SELECT "companyId", MIN("id") AS "integrationId"
    FROM "MarketingIntegration"
   WHERE "provider" = 'GA4' AND "accountId" IS NOT NULL
   GROUP BY "companyId" HAVING COUNT(*) = 1
)
UPDATE "AnalyticsEventParamDaily" t SET "integrationId" = s."integrationId"
  FROM solo s WHERE t."companyId" = s."companyId" AND t."integrationId" = 'legacy';

WITH solo AS (
  SELECT "companyId", MIN("id") AS "integrationId"
    FROM "MarketingIntegration"
   WHERE "provider" = 'SEARCH_CONSOLE' AND "accountId" IS NOT NULL
   GROUP BY "companyId" HAVING COUNT(*) = 1
)
UPDATE "SearchConsoleQuery" t SET "integrationId" = s."integrationId"
  FROM solo s WHERE t."companyId" = s."companyId" AND t."integrationId" = 'legacy';

WITH solo AS (
  SELECT "companyId", MIN("id") AS "integrationId"
    FROM "MarketingIntegration"
   WHERE "provider" = 'BUSINESS_PROFILE' AND "accountId" IS NOT NULL
   GROUP BY "companyId" HAVING COUNT(*) = 1
)
UPDATE "GbpInsight" t SET "integrationId" = s."integrationId"
  FROM solo s WHERE t."companyId" = s."companyId" AND t."integrationId" = 'legacy';

WITH solo AS (
  SELECT "companyId", MIN("id") AS "integrationId"
    FROM "MarketingIntegration"
   WHERE "provider" = 'BUSINESS_PROFILE' AND "accountId" IS NOT NULL
   GROUP BY "companyId" HAVING COUNT(*) = 1
)
UPDATE "GbpReview" t SET "integrationId" = s."integrationId"
  FROM solo s WHERE t."companyId" = s."companyId" AND t."integrationId" = 'legacy';

WITH solo AS (
  SELECT "companyId", MIN("id") AS "integrationId"
    FROM "MarketingIntegration"
   WHERE "provider" = 'BUSINESS_PROFILE' AND "accountId" IS NOT NULL
   GROUP BY "companyId" HAVING COUNT(*) = 1
)
UPDATE "GbpSearchKeyword" t SET "integrationId" = s."integrationId"
  FROM solo s WHERE t."companyId" = s."companyId" AND t."integrationId" = 'legacy';

WITH solo AS (
  SELECT "companyId", MIN("id") AS "integrationId"
    FROM "MarketingIntegration"
   WHERE "provider" = 'BUSINESS_PROFILE' AND "accountId" IS NOT NULL
   GROUP BY "companyId" HAVING COUNT(*) = 1
)
UPDATE "GbpProfileSnapshot" t SET "integrationId" = s."integrationId"
  FROM solo s WHERE t."companyId" = s."companyId" AND t."integrationId" = 'legacy';
