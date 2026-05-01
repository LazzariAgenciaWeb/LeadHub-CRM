-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('GA4', 'SEARCH_CONSOLE', 'BUSINESS_PROFILE', 'GOOGLE_ADS', 'META_ADS');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'ERROR', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "MarketingIntegration" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "accountId" TEXT,
    "accountLabel" TEXT,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "googleEmail" TEXT,
    "googleName" TEXT,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "MarketingIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER NOT NULL DEFAULT 0,
    "newUsers" INTEGER NOT NULL DEFAULT 0,
    "pageviews" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "bounceRate" DOUBLE PRECISION,
    "avgSessionSec" DOUBLE PRECISION,
    "engagedSessions" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsTopPage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "pagePath" TEXT NOT NULL,
    "pageTitle" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER NOT NULL DEFAULT 0,
    "avgTimeSec" DOUBLE PRECISION,

    CONSTRAINT "AnalyticsTopPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsTrafficSource" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "rawSource" TEXT NOT NULL,
    "rawMedium" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsTrafficSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsGeoData" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "countryCode" TEXT,
    "countryName" TEXT,
    "region" TEXT,
    "city" TEXT,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsGeoData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchConsoleQuery" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "query" TEXT NOT NULL,
    "page" TEXT,
    "country" TEXT,
    "device" TEXT,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "ctr" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SearchConsoleQuery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingIntegration_companyId_provider_accountId_key" ON "MarketingIntegration"("companyId", "provider", "accountId");
CREATE INDEX "MarketingIntegration_companyId_idx" ON "MarketingIntegration"("companyId");
CREATE INDEX "MarketingIntegration_status_lastSyncAt_idx" ON "MarketingIntegration"("status", "lastSyncAt");

CREATE UNIQUE INDEX "AnalyticsSnapshot_companyId_date_source_key" ON "AnalyticsSnapshot"("companyId", "date", "source");
CREATE INDEX "AnalyticsSnapshot_companyId_date_idx" ON "AnalyticsSnapshot"("companyId", "date");

CREATE UNIQUE INDEX "AnalyticsTopPage_companyId_date_source_pagePath_key" ON "AnalyticsTopPage"("companyId", "date", "source", "pagePath");
CREATE INDEX "AnalyticsTopPage_companyId_date_idx" ON "AnalyticsTopPage"("companyId", "date");

CREATE UNIQUE INDEX "AnalyticsTrafficSource_companyId_date_source_rawSource_rawMedium_key" ON "AnalyticsTrafficSource"("companyId", "date", "source", "rawSource", "rawMedium");
CREATE INDEX "AnalyticsTrafficSource_companyId_date_bucket_idx" ON "AnalyticsTrafficSource"("companyId", "date", "bucket");

CREATE UNIQUE INDEX "AnalyticsGeoData_companyId_date_source_countryCode_region_city_key" ON "AnalyticsGeoData"("companyId", "date", "source", "countryCode", "region", "city");
CREATE INDEX "AnalyticsGeoData_companyId_date_idx" ON "AnalyticsGeoData"("companyId", "date");

CREATE UNIQUE INDEX "SearchConsoleQuery_companyId_date_query_page_country_device_key" ON "SearchConsoleQuery"("companyId", "date", "query", "page", "country", "device");
CREATE INDEX "SearchConsoleQuery_companyId_date_idx" ON "SearchConsoleQuery"("companyId", "date");
CREATE INDEX "SearchConsoleQuery_companyId_query_idx" ON "SearchConsoleQuery"("companyId", "query");

-- AddForeignKey
ALTER TABLE "MarketingIntegration" ADD CONSTRAINT "MarketingIntegration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsSnapshot" ADD CONSTRAINT "AnalyticsSnapshot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsTopPage" ADD CONSTRAINT "AnalyticsTopPage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsTrafficSource" ADD CONSTRAINT "AnalyticsTrafficSource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsGeoData" ADD CONSTRAINT "AnalyticsGeoData_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SearchConsoleQuery" ADD CONSTRAINT "SearchConsoleQuery_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
