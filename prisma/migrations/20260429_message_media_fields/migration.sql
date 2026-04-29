-- AlterTable: add mediaBase64 and mediaType to Message
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "mediaBase64" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "mediaType" TEXT;
