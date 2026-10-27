-- Página do Negócio: indicação (cadastro vindo do selo de outra página).
-- Em produção o start.sh aplica via `prisma db push`; este SQL é documental.

-- AlterTable
ALTER TABLE "BioPage" ADD COLUMN     "referredById" TEXT;

-- AddForeignKey
ALTER TABLE "BioPage" ADD CONSTRAINT "BioPage_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "BioPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

