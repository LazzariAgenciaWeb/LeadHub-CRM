-- Log de visitas ao link de aprovação: quantas vezes abriu e quantos slides passou.
ALTER TABLE "ProjectTask" ADD COLUMN "approvalLastViewAt" TIMESTAMP(3);
ALTER TABLE "ProjectTask" ADD COLUMN "approvalViewCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProjectTask" ADD COLUMN "approvalSlidesSeen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProjectTask" ADD COLUMN "approvalSlidesTotal" INTEGER NOT NULL DEFAULT 0;
