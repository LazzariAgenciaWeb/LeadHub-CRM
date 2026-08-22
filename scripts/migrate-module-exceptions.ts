/**
 * Converte o estado atual de `Company.module*` em exceções explícitas na
 * assinatura, antes das flags virarem cache derivado.
 *
 * POR QUE ISSO É OBRIGATÓRIO
 * Até agora a agência ligava módulo na mão no Editar empresa, muitas vezes fora
 * do que o plano dá. A partir da reorganização, `Company.module*` passa a ser
 * recalculado do plano + exceções a cada save. Sem esta migração, o primeiro
 * save de qualquer empresa apagaria esses módulos manuais e o cliente perderia
 * acesso — em produção, sem aviso.
 *
 * O que ele faz: para cada empresa, compara a flag atual com o que o plano
 * daria. Onde diverge, grava a divergência como exceção em
 * `Subscription.customFeatures`. Resultado: acesso de todo mundo fica
 * exatamente igual ao de hoje, só que agora explícito e visível na tela.
 *
 * Uso:
 *   npx tsx scripts/migrate-module-exceptions.ts          # dry-run (não grava)
 *   npx tsx scripts/migrate-module-exceptions.ts --apply  # grava
 */

import { PrismaClient } from "../src/generated/prisma";
import { backfillExceptions, MODULES, type CompanyModuleField } from "../src/lib/modules";
import type { PlanFeatures, PlanTier } from "../src/lib/plans";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const FLAG_FIELDS = Array.from(
  new Set(
    MODULES.flatMap((m) => [
      ...(m.companyField ? [m.companyField] : []),
      ...(m.advanced ?? []).flatMap((a) => (a.companyField ? [a.companyField] : [])),
    ])
  )
) as CompanyModuleField[];

async function main() {
  const companies = await prisma.company.findMany({
    select: {
      id: true,
      name: true,
      ...Object.fromEntries(FLAG_FIELDS.map((f) => [f, true])),
      subscription: { select: { id: true, plan: true, customFeatures: true } },
    } as any,
  });

  console.log(`${APPLY ? "APLICANDO" : "DRY-RUN"} — ${companies.length} empresas\n`);

  let changed = 0;
  let skipped = 0;

  for (const c of companies as any[]) {
    const flags: Partial<Record<CompanyModuleField, boolean>> = {};
    for (const f of FLAG_FIELDS) flags[f] = c[f] ?? undefined;

    // Empresa SEM assinatura é o caso mais perigoso: no modelo antigo a flag
    // ligada já liberava o módulo, sem depender de plano nenhum. No modelo
    // novo, sem assinatura o gate cai em FREE e o acesso some. Então criamos a
    // assinatura (FREE) carregando as flags de hoje como exceção.
    if (!c.subscription) {
      const next = backfillExceptions("FREE", flags, null);
      const keys = Object.keys(next);
      console.log(
        `· ${c.name}: SEM assinatura → cria FREE com ${keys.length} exceç${keys.length === 1 ? "ão" : "ões"}` +
          (keys.length ? `: ${keys.map((k) => `${k}=${(next as any)[k]}`).join(", ")}` : "")
      );
      changed++;
      if (APPLY) {
        await prisma.subscription.create({
          data: {
            companyId: c.id,
            plan: "FREE",
            status: "ACTIVE",
            customFeatures: keys.length ? (next as any) : undefined,
          },
        });
      }
      continue;
    }

    const tier = (c.subscription.plan as PlanTier) ?? "FREE";
    const custom = (c.subscription.customFeatures as Partial<PlanFeatures> | null) ?? null;

    const next = backfillExceptions(tier, flags, custom);

    const before = JSON.stringify(custom ?? {});
    const after = JSON.stringify(next);
    if (before === after) {
      skipped++;
      continue;
    }

    const added = Object.keys(next).filter(
      (k) => (custom ?? {})[k as keyof PlanFeatures] === undefined
    );
    console.log(
      `· ${c.name} [${tier}] → ${added.length} exceç${added.length === 1 ? "ão" : "ões"}: ` +
        added.map((k) => `${k}=${(next as any)[k]}`).join(", ")
    );
    changed++;

    if (APPLY) {
      await prisma.subscription.update({
        where: { id: c.subscription.id },
        data: { customFeatures: next as any },
      });
    }
  }

  console.log(
    `\n${changed} empresa(s) ${APPLY ? "migradas" : "seriam migradas"} · ${skipped} sem mudança.`
  );
  if (!APPLY && changed > 0) {
    console.log("Rode de novo com --apply para gravar.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
