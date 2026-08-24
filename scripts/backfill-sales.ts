/**
 * Cria a `Sale` das vendas que já estavam fechadas antes da esteira existir.
 *
 * Sem isto a esteira nasce vazia e todo negócio ganho no passado fica invisível
 * pro Financeiro — inclusive os que de fato ainda não viraram contrato ou
 * fatura, que são justamente os que interessam.
 *
 * Idempotente: `leadId` é único em Sale, então rodar de novo não duplica nada.
 * Depende de `wonAt` — rode antes o `npm run db:backfill-outcome-dates -- --apply`.
 *
 * Uso:
 *   npx tsx scripts/backfill-sales.ts          # dry-run
 *   npx tsx scripts/backfill-sales.ts --apply
 */

import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const won = await prisma.lead.findMany({
    where: { status: "CLOSED", sale: { is: null } },
    select: {
      id: true, companyId: true, name: true, phone: true,
      value: true, clickupTaskId: true, wonAt: true, updatedAt: true,
    },
    orderBy: { updatedAt: "asc" },
  });

  const semData = won.filter((l) => !l.wonAt).length;
  console.log(`${won.length} venda(s) fechada(s) sem registro na esteira.`);
  if (semData > 0) {
    console.log(
      `  ⚠ ${semData} sem wonAt — vão usar updatedAt como data de fechamento.\n` +
      `    Rode antes: npm run db:backfill-outcome-dates -- --apply`
    );
  }

  if (!APPLY) {
    for (const l of won.slice(0, 10)) {
      console.log(`  · ${l.name ?? l.phone} — ${(l.value ?? 0).toLocaleString("pt-BR")}`);
    }
    if (won.length > 10) console.log(`  … e mais ${won.length - 10}`);
    console.log("\nDry-run. Rode com --apply pra gravar.");
    return;
  }

  let criadas = 0;
  for (const l of won) {
    await prisma.sale.create({
      data: {
        companyId: l.companyId,
        leadId: l.id,
        title: l.name?.trim() || `Contato ${l.phone}`,
        valueCents: Math.round((l.value ?? 0) * 100),
        closedAt: l.wonAt ?? l.updatedAt,
        clickupTaskId: l.clickupTaskId,
      },
    });
    criadas++;
  }
  console.log(`${criadas} venda(s) criada(s) na esteira.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
