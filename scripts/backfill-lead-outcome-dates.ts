/**
 * Aplica prisma/migrations/20260824_lead_outcome_dates/migration.sql.
 *
 * POR QUE EXISTE ESTE SCRIPT
 * O deploy roda `prisma db push` (start.sh), que cria as colunas novas mas
 * NUNCA executa os arquivos de migration. Ou seja: `wonAt`/`lostAt` nascem
 * em produção vazios, e todo lead já fechado ficaria fora dos relatórios de
 * "ganho no mês" pra sempre. Este script roda o SQL — colunas, índices e o
 * backfill a partir da timeline (Activity STAGE_CHANGED).
 *
 * É idempotente: os UPDATE só tocam linhas com a data ainda nula.
 *
 * Uso:
 *   npx tsx scripts/backfill-lead-outcome-dates.ts          # dry-run (só conta)
 *   npx tsx scripts/backfill-lead-outcome-dates.ts --apply  # executa
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const SQL_PATH = join(
  __dirname,
  "..",
  "prisma",
  "migrations",
  "20260824_lead_outcome_dates",
  "migration.sql"
);

/** Quebra o arquivo em statements, ignorando comentários e linhas vazias. */
function statements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((chunk) =>
      chunk
        .split(/\r?\n/)
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(Boolean);
}

async function main() {
  const [closed, lost] = await Promise.all([
    prisma.lead.count({ where: { status: "CLOSED", wonAt: null } }),
    prisma.lead.count({ where: { status: "LOST", lostAt: null } }),
  ]).catch(() => [null, null] as const);

  console.log(
    closed === null
      ? "Colunas ainda não existem no banco — o SQL vai criá-las."
      : `Pendentes de backfill: ${closed} ganho(s), ${lost} perda(s).`
  );

  if (!APPLY) {
    console.log("\nDry-run. Rode com --apply pra executar.");
    return;
  }

  const sql = readFileSync(SQL_PATH, "utf-8");
  for (const stmt of statements(sql)) {
    const label = stmt.replace(/\s+/g, " ").slice(0, 70);
    const affected = await prisma.$executeRawUnsafe(stmt);
    console.log(`  ✓ ${label}…  (${affected} linha(s))`);
  }
  console.log("\nBackfill concluído.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
