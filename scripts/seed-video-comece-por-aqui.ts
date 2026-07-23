/**
 * Seed idempotente da trilha padrão "Comece por aqui" na biblioteca de vídeos.
 *
 * Cria uma VideoCategory GLOBAL + visibility ALL, posicionada no topo — ou seja,
 * toda empresa com o módulo de Vídeos (incluindo o plano FREE, que já tem
 * `videos: true`) vê essa trilha. É a "trilha padrão" de introdução: gestão das
 * ferramentas, planejamento e primeiras orientações.
 *
 * Rodar UMA vez (idempotente — se já existir, não duplica):
 *   npx tsx scripts/seed-video-comece-por-aqui.ts
 *
 * Depois, adicione o vídeo em /videos → trilha "Comece por aqui". A trilha só
 * aparece pro cliente quando tiver ao menos 1 vídeo ativo.
 */
import { prisma } from "../src/lib/prisma";

const TITLE = "Comece por aqui";

async function main() {
  const existing = await prisma.videoCategory.findFirst({
    where: { scope: "GLOBAL", title: TITLE },
    select: { id: true },
  });
  if (existing) {
    console.log(`Trilha "${TITLE}" já existe (id: ${existing.id}). Nada a fazer.`);
    return;
  }

  // Posição no topo: uma abaixo da menor posição existente (garante ser a 1ª fileira).
  const agg = await prisma.videoCategory.aggregate({
    where: { scope: "GLOBAL" },
    _min: { position: true },
  });
  const position = (agg._min.position ?? 0) - 1;

  const cat = await prisma.videoCategory.create({
    data: {
      title: TITLE,
      description:
        "Trilha de introdução — como usar o LeadHub, gestão das ferramentas e primeiras orientações.",
      emoji: "🚀",
      position,
      active: true,
      scope: "GLOBAL",
      visibility: "ALL",
    },
    select: { id: true },
  });

  console.log(`Trilha "${TITLE}" criada (id: ${cat.id}, posição ${position}, GLOBAL + visível a todos).`);
  console.log("Próximo passo: adicione o vídeo em /videos → trilha 'Comece por aqui'.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
