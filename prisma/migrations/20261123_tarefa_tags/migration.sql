-- Etiquetas livres nas tarefas de projeto (Reels, Carrossel, Stories…).
ALTER TABLE "ProjectTask" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
