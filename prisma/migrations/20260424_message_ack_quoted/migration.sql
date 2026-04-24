-- AlterTable: adiciona campos de ACK e citação ao modelo Message
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "ack" INTEGER;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "quotedId" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "quotedBody" TEXT;
