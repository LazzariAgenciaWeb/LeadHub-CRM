-- AddColumn: webhookToken to Company
ALTER TABLE "Company" ADD COLUMN "webhookToken" TEXT;

-- AddUniqueIndex
CREATE UNIQUE INDEX "Company_webhookToken_key" ON "Company"("webhookToken");
