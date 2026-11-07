CREATE TABLE "BioProgress" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "visitorId" TEXT NOT NULL,
  "answers" JSONB NOT NULL DEFAULT '[]',
  "reachedForm" BOOLEAN NOT NULL DEFAULT false,
  "convertedAt" TIMESTAMP(3),
  "submissionId" TEXT,
  "referrer" TEXT,
  "utmSource" TEXT,
  "utmMedium" TEXT,
  "utmCampaign" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BioProgress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BioProgress_submissionId_key" ON "BioProgress"("submissionId");
CREATE UNIQUE INDEX "BioProgress_pageId_visitorId_key" ON "BioProgress"("pageId", "visitorId");
CREATE INDEX "BioProgress_pageId_updatedAt_idx" ON "BioProgress"("pageId", "updatedAt");
ALTER TABLE "BioProgress" ADD CONSTRAINT "BioProgress_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "BioPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BioProgress" ADD CONSTRAINT "BioProgress_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "BioSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
