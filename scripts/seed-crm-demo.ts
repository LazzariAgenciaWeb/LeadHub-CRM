/**
 * Popula o CRM local com oportunidades espalhadas no tempo, pra dar pra ver o
 * recorte por período e os totais separados funcionando (base de dev nasce
 * vazia e o board fica indistinguível de quebrado).
 *
 * NÃO roda fora de localhost — checagem explícita abaixo.
 *
 * Uso:
 *   npx tsx scripts/seed-crm-demo.ts [--reset]
 */

import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();
const RESET = process.argv.includes("--reset");

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("Abortado: este seed é só pra banco local. DATABASE_URL não aponta pra localhost.");
  process.exit(1);
}

const STAGES = [
  { name: "Reunião Realizada", color: "#8b5cf6", order: 0, isFinal: false, outcome: "NEUTRO" as const },
  { name: "Proposta Enviada", color: "#3b82f6", order: 1, isFinal: false, outcome: "NEUTRO" as const },
  { name: "Em Negociação", color: "#f59e0b", order: 2, isFinal: false, outcome: "NEUTRO" as const },
  { name: "Fechado ✅", color: "#22c55e", order: 3, isFinal: true, outcome: "GANHO" as const },
  { name: "Perdido ❌", color: "#ef4444", order: 4, isFinal: true, outcome: "PERDIDO" as const },
];

/** Data a N meses atrás, no dia informado. */
function monthsAgo(n: number, day: number) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - n, day, 10, 0, 0);
}

// [nome, valor, etapa, mesesAtrás(null = aberto, sem desfecho)]
const LEADS: [string, number, string, number | null][] = [
  ["Clínica Vida Plena", 4800, "Reunião Realizada", null],
  ["Restaurante Bom Prato", 2400, "Reunião Realizada", null],
  ["Studio Pilates Corpo", 1900, "Proposta Enviada", null],
  ["Auto Center Rodas", 6200, "Proposta Enviada", null],
  ["Imobiliária Terra Nova", 8500, "Proposta Enviada", null],
  ["Escola Semear", 3300, "Em Negociação", null],
  ["Petshop Focinho Feliz", 1500, "Em Negociação", null],
  ["Advocacia Marques", 7400, "Em Negociação", null],
  // Ganhos no mês corrente
  ["Odonto Sorriso", 3900, "Fechado ✅", 0],
  ["Construtora Alicerce", 12500, "Fechado ✅", 0],
  ["Hamburgueria do Zé", 1800, "Fechado ✅", 0],
  // Ganhos no mês passado
  ["Academia Movimento", 2900, "Fechado ✅", 1],
  ["Ótica Visão Clara", 2100, "Fechado ✅", 1],
  // Ganhos antigos — os que hoje poluem a coluna pra sempre
  ["Mercado Central", 5600, "Fechado ✅", 5],
  ["Transportadora Rota Sul", 9800, "Fechado ✅", 8],
  ["Padaria Pão Quente", 1200, "Fechado ✅", 14],
  // Perdas
  ["Salão Beleza Pura", 2600, "Perdido ❌", 0],
  ["Consultoria Prisma", 15000, "Perdido ❌", 1],
  ["Loja Kids Mundo", 3100, "Perdido ❌", 7],
];

// Dois abertos sem valor: reproduzem o "12 cards · R$ 3.000 não bate".
const SEM_VALOR: [string, string][] = [
  ["Lead Sem Orçamento", "Reunião Realizada"],
  ["Contato Frio Indicação", "Proposta Enviada"],
];

async function main() {
  const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
  if (!company) throw new Error("Nenhuma empresa no banco local — rode `npm run db:seed` antes.");
  console.log(`Empresa: ${company.name}`);

  if (RESET) {
    const del = await prisma.lead.deleteMany({ where: { companyId: company.id, pipeline: "OPORTUNIDADES" } });
    console.log(`Removidas ${del.count} oportunidade(s) anteriores.`);
  }

  for (const st of STAGES) {
    const found = await prisma.pipelineStageConfig.findFirst({
      where: { companyId: company.id, pipeline: "OPORTUNIDADES", name: st.name },
    });
    if (found) {
      await prisma.pipelineStageConfig.update({ where: { id: found.id }, data: st });
    } else {
      await prisma.pipelineStageConfig.create({
        data: { ...st, pipeline: "OPORTUNIDADES", companyId: company.id },
      });
    }
  }
  console.log(`${STAGES.length} etapas configuradas (com outcome).`);

  let phone = 5551990000000;
  let criados = 0;
  for (const [name, value, stage, ago] of LEADS) {
    const won = stage === "Fechado ✅";
    const lost = stage === "Perdido ❌";
    const at = ago === null ? null : monthsAgo(ago, 12);
    await prisma.lead.create({
      data: {
        companyId: company.id,
        name,
        phone: String(phone++),
        source: "seed-demo",
        value,
        pipeline: "OPORTUNIDADES",
        pipelineStage: stage,
        status: won ? "CLOSED" : lost ? "LOST" : "NEW",
        wonAt: won ? at : null,
        lostAt: lost ? at : null,
        createdAt: at ? new Date(at.getTime() - 20 * 864e5) : new Date(),
      },
    });
    criados++;
  }
  for (const [name, stage] of SEM_VALOR) {
    await prisma.lead.create({
      data: {
        companyId: company.id, name, phone: String(phone++), source: "seed-demo",
        pipeline: "OPORTUNIDADES", pipelineStage: stage, status: "NEW",
      },
    });
    criados++;
  }
  console.log(`${criados} oportunidades criadas.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
