-- SUPER_ADMIN: instâncias de WhatsApp escondidas da visão global.
ALTER TABLE "User" ADD COLUMN "hiddenWaInstanceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
