-- IPs da equipe (aprendidos no uso do LeadHub) + IP da última visita do cliente.
CREATE TABLE "InternalIp" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL DEFAULT '',
  "ip" TEXT NOT NULL,
  "userId" TEXT,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InternalIp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InternalIp_companyId_ip_key" ON "InternalIp"("companyId", "ip");
CREATE INDEX "InternalIp_ip_idx" ON "InternalIp"("ip");
ALTER TABLE "ProjectTask" ADD COLUMN "approvalLastViewIp" TEXT;
