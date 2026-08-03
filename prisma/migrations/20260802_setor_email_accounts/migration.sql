-- Caixas de email por setor (espelho do SetorInstance do WhatsApp).
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

CREATE TABLE "SetorEmailAccount" (
    "id" TEXT NOT NULL,
    "setorId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SetorEmailAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SetorEmailAccount_setorId_accountId_key" ON "SetorEmailAccount"("setorId", "accountId");
CREATE INDEX "SetorEmailAccount_accountId_idx" ON "SetorEmailAccount"("accountId");

ALTER TABLE "SetorEmailAccount" ADD CONSTRAINT "SetorEmailAccount_setorId_fkey"
    FOREIGN KEY ("setorId") REFERENCES "Setor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetorEmailAccount" ADD CONSTRAINT "SetorEmailAccount_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
