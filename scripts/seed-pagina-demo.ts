/**
 * Página do Negócio de demonstração, para ver a página em pé no computador e no
 * celular sem depender de dados reais. Só desenvolvimento.
 *
 * Rodar:  npm run seed:pagina-demo
 *
 * O que faz (idempotente — pode rodar várias vezes):
 *  - pega a primeira empresa ativa e a página dela (cria o rascunho se faltar);
 *  - preenche capa, foto, serviços com imagem, botões, agenda, contato e
 *    perguntas, e PUBLICA;
 *  - aponta um domínio de teste pra ela, já ATIVO (status "à mão"), pra dar pra
 *    abrir o site pelo domínio: curl -H "Host: www.lojateste.com.br" localhost:3000
 *
 * O domínio pode vir por argumento: npm run seed:pagina-demo -- www.outro.com.br
 */
import { PrismaClient } from "../src/generated/prisma";
import { normalizeBioDomain, bioDomainProblem } from "../src/lib/bio-page";
import { ensureBioPage } from "../src/lib/bio-page-server";

const prisma = new PrismaClient();

const HOSTNAME = normalizeBioDomain(process.argv[2] ?? "www.lojateste.com.br");

const SERVICOS = [
  { title: "Troca de óleo e filtros", priceLabel: "a partir de R$ 180", description: "Óleo sintético, filtro de óleo e de ar, com revisão de 20 itens cortesia." },
  { title: "Alinhamento e balanceamento", priceLabel: "R$ 120", description: "Alinhamento computadorizado 3D e balanceamento das quatro rodas." },
  { title: "Revisão completa", priceLabel: "sob consulta", description: "Freios, suspensão, correias, fluidos e diagnóstico eletrônico." },
  { title: "Ar-condicionado", priceLabel: "a partir de R$ 220", description: "Higienização, troca do filtro da cabine e recarga de gás." },
];

const LINKS = [
  { title: "Chamar no WhatsApp", url: "https://wa.me/5545999990000", network: "whatsapp", description: "Resposta em minutos no horário comercial" },
  { title: "Ver no Google Meu Negócio", url: "https://maps.google.com", network: "google", description: "47 avaliações, nota 4,9" },
  { title: "Tabela de serviços (PDF)", url: "https://example.com/tabela.pdf", network: "site", description: null },
];

const SOCIAIS = [
  { title: "Instagram", url: "https://instagram.com/exemplo", network: "instagram" },
  { title: "Facebook", url: "https://facebook.com/exemplo", network: "facebook" },
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Este script é só para desenvolvimento.");
  }
  const problema = bioDomainProblem(HOSTNAME);
  if (problema) throw new Error(`Domínio de teste inválido (${HOSTNAME}): ${problema}`);

  const company = await prisma.company.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, tradeName: true },
  });
  if (!company) throw new Error("Nenhuma empresa ativa no banco — rode o npm run db:seed primeiro.");

  const pageId = await ensureBioPage(company.id);

  await prisma.bioPage.update({
    where: { id: pageId },
    data: {
      template: "VITRINE",
      title: company.tradeName ?? company.name,
      headline: "Mecânica e centro automotivo em Maripá — há 12 anos no mesmo lugar",
      about:
        "Somos oficina de bairro, com equipamento de concessionária. Diagnóstico eletrônico, peças com nota e garantia de 6 meses na mão de obra.\n\nAtendemos com hora marcada: você deixa o carro, a gente manda o orçamento pelo WhatsApp e só começa depois do seu ok.",
      avatarUrl: "https://picsum.photos/seed/gohub-logo/320/320",
      coverUrl: "https://picsum.photos/seed/gohub-capa/1600/600",
      accentColor: "#0f766e",
      published: true,
      publishedAt: new Date(),
      freeLimits: false,
      quizEnabled: true,
      quizTitle: "Responda 2 perguntas e a gente já manda o orçamento",
      quizCta: "Pedir orçamento",
      bookingUrl: "https://cal.com/exemplo/revisao",
      bookingText: "Escolha o dia e deixe o carro com a gente — devolvemos no mesmo dia.",
      contactPhone: "45 99999-0000",
      contactEmail: "contato@exemplo.com.br",
      contactAddress: "Av. Brasil, 1200 — Centro, Maripá - PR",
      contactHours: "Segunda a sexta, 8h às 18h\nSábado, 8h às 12h",
    },
  });

  // Itens: limpa e recria, pra rodar de novo não duplicar.
  await prisma.bioBlock.deleteMany({ where: { pageId } });
  let order = 0;
  for (const s of SOCIAIS) {
    await prisma.bioBlock.create({ data: { pageId, type: "SOCIAL", order: order++, ...s, description: null } });
  }
  for (const l of LINKS) {
    await prisma.bioBlock.create({ data: { pageId, type: "LINK", order: order++, ...l } });
  }
  for (const [i, s] of SERVICOS.entries()) {
    await prisma.bioBlock.create({
      data: {
        pageId,
        type: "SERVICE",
        order: order++,
        title: s.title,
        description: s.description,
        priceLabel: s.priceLabel,
        imageUrl: `https://picsum.photos/seed/gohub-servico-${i}/800/800`,
        url: null,
        network: null,
      },
    });
  }

  const perguntas = await prisma.bioQuestion.count({ where: { pageId } });
  if (perguntas === 0) {
    await prisma.bioQuestion.createMany({
      data: [
        { pageId, text: "O que o carro precisa?", options: ["Revisão", "Troca de óleo", "Barulho/problema", "Não sei, quero avaliar"], order: 0 },
        { pageId, text: "Para quando você precisa?", options: ["Hoje ou amanhã", "Nesta semana", "Só estou pesquisando"], order: 1 },
      ],
    });
  }

  // Domínio de teste já ativo: é o status ACTIVE que faz o proxy servir o site
  // nele. `manual` impede o cron de derrubar (não existe DNS de verdade aqui).
  const dados = {
    hostname: HOSTNAME,
    status: "ACTIVE" as const,
    statusMessage: null,
    cfHostnameId: null,
    verifyName: null,
    verifyValue: null,
    cnameTarget: "sites.gohub.com.br",
    manual: true,
    verifiedAt: new Date(),
    lastCheckedAt: new Date(),
  };
  await prisma.bioDomain.deleteMany({ where: { hostname: HOSTNAME, NOT: { pageId } } });
  await prisma.bioDomain.upsert({ where: { pageId }, create: { pageId, ...dados }, update: dados });

  const page = await prisma.bioPage.findUniqueOrThrow({ where: { id: pageId }, select: { slug: true } });
  console.log(`Página de demonstração pronta para "${company.tradeName ?? company.name}".`);
  console.log(`  endereço do sistema: http://localhost:3000/p/${page.slug}`);
  console.log(`  domínio de teste:    ${HOSTNAME} (ativo à mão)`);
  console.log(`  abrir pelo domínio:  curl -s -H "Host: ${HOSTNAME}" http://localhost:3000/ | head`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
