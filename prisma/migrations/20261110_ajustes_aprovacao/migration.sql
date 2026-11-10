-- Ajustes pedidos pelo cliente no link de aprovação: um registro por pedido.
CREATE TABLE IF NOT EXISTS "ProjectTaskAdjustment" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "round" INTEGER NOT NULL,
  "authorName" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "fileId" TEXT,
  "fileLabel" TEXT,
  "deviceKey" TEXT,
  "sentAt" TIMESTAMP(3),
  "late" BOOLEAN NOT NULL DEFAULT false,
  "doneAt" TIMESTAMP(3),
  "doneByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectTaskAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProjectTaskAdjustment_taskId_round_idx" ON "ProjectTaskAdjustment"("taskId", "round");

DO $$ BEGIN
  ALTER TABLE "ProjectTaskAdjustment" ADD CONSTRAINT "ProjectTaskAdjustment_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
