-- Chamado vinculado a uma etapa (ProjectService) do projeto.
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "etapaId" TEXT;
DO $$ BEGIN
  ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_etapaId_fkey" FOREIGN KEY ("etapaId") REFERENCES "ProjectService"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
