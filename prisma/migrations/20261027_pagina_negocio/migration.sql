-- Página do Negócio (link na bio + vitrine) e planos PAGINA/STARTER.
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

-- CreateEnum
CREATE TYPE "BioTemplate" AS ENUM ('CARTAO', 'VITRINE');

-- CreateEnum
CREATE TYPE "BioBlockType" AS ENUM ('LINK', 'SERVICE', 'SOCIAL');

-- CreateEnum
CREATE TYPE "BioEventKind" AS ENUM ('VIEW', 'CLICK', 'QUIZ_START', 'QUIZ_COMPLETE', 'LEAD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PlanTier" ADD VALUE 'PAGINA';
ALTER TYPE "PlanTier" ADD VALUE 'STARTER';

-- CreateTable
CREATE TABLE "BioPage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "template" "BioTemplate" NOT NULL DEFAULT 'CARTAO',
    "title" TEXT NOT NULL,
    "headline" TEXT,
    "about" TEXT,
    "avatarUrl" TEXT,
    "coverUrl" TEXT,
    "accentColor" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "quizEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quizTitle" TEXT,
    "quizCta" TEXT,
    "thankYouMessage" TEXT,
    "consentText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BioPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioBlock" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "type" "BioBlockType" NOT NULL DEFAULT 'LINK',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "imageUrl" TEXT,
    "priceLabel" TEXT,
    "network" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BioBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioQuestion" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "options" TEXT[],
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BioQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioSubmission" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "leadId" TEXT,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "name" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "visitorId" TEXT,
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "clientIp" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BioSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioEvent" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "kind" "BioEventKind" NOT NULL,
    "blockId" TEXT,
    "targetLabel" TEXT,
    "visitorId" TEXT,
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BioEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BioPage_companyId_key" ON "BioPage"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "BioPage_slug_key" ON "BioPage"("slug");

-- CreateIndex
CREATE INDEX "BioBlock_pageId_order_idx" ON "BioBlock"("pageId", "order");

-- CreateIndex
CREATE INDEX "BioQuestion_pageId_order_idx" ON "BioQuestion"("pageId", "order");

-- CreateIndex
CREATE INDEX "BioSubmission_pageId_createdAt_idx" ON "BioSubmission"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "BioSubmission_leadId_idx" ON "BioSubmission"("leadId");

-- CreateIndex
CREATE INDEX "BioEvent_pageId_createdAt_idx" ON "BioEvent"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "BioEvent_pageId_kind_createdAt_idx" ON "BioEvent"("pageId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "BioPage" ADD CONSTRAINT "BioPage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioBlock" ADD CONSTRAINT "BioBlock_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "BioPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioQuestion" ADD CONSTRAINT "BioQuestion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "BioPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioSubmission" ADD CONSTRAINT "BioSubmission_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "BioPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioSubmission" ADD CONSTRAINT "BioSubmission_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioEvent" ADD CONSTRAINT "BioEvent_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "BioPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

