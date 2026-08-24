/**
 * Importa a lista "Contratos Mensais" do ClickUp para os contratos do
 * Financeiro. Mesma regra da tela em /financeiro/importar — ambas consomem
 * src/lib/clickup-contratos.ts, então não têm como divergir.
 *
 * Existe além da tela porque em migração grande é bom poder rodar no
 * servidor, ver o relatório inteiro no terminal e repetir sem depender de
 * navegador aberto.
 *
 * Uso:
 *   npx tsx scripts/import-clickup-contratos.ts                 # prévia
 *   npx tsx scripts/import-clickup-contratos.ts --apply
 *   npx tsx scripts/import-clickup-contratos.ts --incluir-encerrados
 *   npx tsx scripts/import-clickup-contratos.ts --lista <id> --empresa <companyId>
 */

import { prisma } from "../src/lib/prisma";
import {
  LISTA_CONTRATOS_PADRAO,
  analisarImportacao,
  aplicarImportacao,
  fetchContratos,
} from "../src/lib/clickup-contratos";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function main() {
  const agencyId =
    opt("empresa") ??
    (await prisma.company.findFirst({ where: { parentCompanyId: null }, orderBy: { createdAt: "asc" } }))?.id;
  if (!agencyId) throw new Error("Nenhuma agência encontrada. Passe --empresa <companyId>.");

  const agency = await prisma.company.findUnique({ where: { id: agencyId }, select: { name: true } });
  const token =
    process.env.CLICKUP_API_TOKEN?.trim() ||
    (await prisma.setting.findUnique({ where: { key: `clickup_api_token:${agencyId}` } }))?.value?.trim();
  if (!token) throw new Error("Sem token do ClickUp (CLICKUP_API_TOKEN ou integração da empresa).");

  const listId = opt("lista") ?? LISTA_CONTRATOS_PADRAO;
  console.log(`Agência: ${agency?.name}\nLista: ${listId}\n`);

  const tasks = await fetchContratos(token, listId);
  const r = await analisarImportacao(agencyId, tasks, flag("incluir-encerrados"));

  console.log(`${r.totalTasks} task(s) · ${r.encerradas} encerrada(s) fora · ${r.contratos} contrato(s).`);
  console.log("\n── Por categoria ──");
  for (const c of r.porCategoria) {
    console.log(`  ${c.categoria.padEnd(20)} ${String(c.n).padStart(3)}   ${brl(c.cents).padStart(14)}`);
  }
  console.log(`\n  Recorrência equivalente mensal: ${brl(r.mrrCents)}`);
  if (r.semValor) console.log(`  ⚠ ${r.semValor} sem valor — não entram na previsão.`);
  if (r.semDia) console.log(`  ⚠ ${r.semDia} sem dia de vencimento.`);

  const semCnpj = r.clientesExistentes.filter((c) => !c.temCnpj).length;
  console.log(
    `\n  ${r.clientesExistentes.length} cliente(s) já cadastrado(s) · ${r.clientesNovos.length} a criar.`
  );
  if (semCnpj + r.clientesNovos.length > 0) {
    console.log(`  ⚠ ${semCnpj + r.clientesNovos.length} ficarão sem CNPJ (chave do Bling).`);
  }
  if (r.nomesParecidos.length) {
    console.log(`  ⚠ ${r.nomesParecidos.length} par(es) de nome parecido:`);
    for (const [a, b] of r.nomesParecidos.slice(0, 15)) console.log(`      ${a}  ~  ${b}`);
  }

  if (!flag("apply")) {
    if (r.clientesNovos.length) {
      console.log("\n── Clientes que serão criados ──");
      for (const n of r.clientesNovos.slice(0, 30)) console.log(`  + ${n}`);
      if (r.clientesNovos.length > 30) console.log(`  … e mais ${r.clientesNovos.length - 30}`);
    }
    console.log("\nPrévia. Rode com --apply pra gravar.");
    return;
  }

  const out = await aplicarImportacao(agencyId, r.itens);
  console.log(
    `\n${out.criados} criado(s), ${out.atualizados} atualizado(s), ${out.clientesNovos} cliente(s) novo(s).`
  );
}

main()
  .catch((e) => { console.error("\n✖", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
