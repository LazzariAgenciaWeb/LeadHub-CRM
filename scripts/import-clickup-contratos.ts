/**
 * Importa a lista "Contratos Mensais" do ClickUp para os contratos do
 * Financeiro (ClientService), criando as empresas-cliente que faltarem.
 *
 * POR QUE
 * A lista do ClickUp é hoje a fonte da verdade dos recorrentes — hospedagem,
 * gestão de mídias, marketing. Enquanto ela viver lá, a fila "a faturar" do
 * LeadHub nasce vazia e a previsão do mês não existe. Depois de importar, a
 * conferência mensal passa a ser derivada (contrato devido × fatura lançada),
 * e quando o Bling entrar ele bate contra a mesma conta.
 *
 * MAPEAMENTO (campos personalizados da lista)
 *   Valor (currency)        → amountCents
 *   Periodicidade (dropdown)→ billingCycle  (Mensal → MENSAL, Anual → ANUAL)
 *   DIA VENCIMENTO (texto)  → billingDay
 *   SERVICO (dropdown)      → rótulo do contrato (cai no status da task se vazio)
 *   Status (dropdown)       → situação (Cobrando/Faturar → ATIVO, Aguardando → EM_IMPLANTACAO)
 *   Url                     → url
 *   Descritivo + Anotações  → notes (junto com a descrição da task)
 *   status da task          → categoria; "encerrados"/"finalizado" ficam de fora
 *
 * IDEMPOTENTE: casa por (provider="clickup", externalId=<id da task>). Rodar de
 * novo ATUALIZA o contrato existente — pode reimportar sempre que a lista mudar.
 *
 * TOKEN: CLICKUP_API_TOKEN no ambiente, ou o já salvo em
 * Setting["clickup_api_token:<empresa>"] (é o caso em produção).
 *
 * Uso:
 *   npx tsx scripts/import-clickup-contratos.ts                 # dry-run
 *   npx tsx scripts/import-clickup-contratos.ts --apply
 *   npx tsx scripts/import-clickup-contratos.ts --incluir-encerrados
 *   npx tsx scripts/import-clickup-contratos.ts --lista 900100018035 --empresa <companyId>
 */

import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const APPLY = flag("apply");
const INCLUIR_ENCERRADOS = flag("incluir-encerrados");
const LIST_ID = opt("lista") ?? "900100018035";

/** Status de task que significam contrato morto — fora da previsão. */
const STATUS_MORTOS = new Set(["encerrados", "finalizado"]);

// ─── ClickUp ────────────────────────────────────────────────────────────────

interface CuField {
  id: string;
  name: string;
  type: string;
  value?: unknown;
  type_config?: { options?: { name: string; orderindex: number }[] };
}
interface CuTask {
  id: string;
  custom_id?: string;
  name: string;
  status: string;
  url: string;
  text_content?: string;
  description?: string;
  custom_fields: CuField[];
}

function field(t: CuTask, name: string): CuField | undefined {
  return t.custom_fields.find((f) => f.name === name);
}

/** Texto de um campo simples. Vazio vira undefined. */
function text(t: CuTask, name: string): string | undefined {
  const v = field(t, name)?.value;
  const s = typeof v === "string" ? v.trim() : "";
  return s || undefined;
}

/** Dropdown: o valor vem como orderindex, não como rótulo. */
function dropdown(t: CuTask, name: string): string | undefined {
  const f = field(t, name);
  if (f?.value === undefined || f.value === null) return undefined;
  const idx = Number(f.value);
  const opts = f.type_config?.options ?? [];
  return opts.find((o) => o.orderindex === idx)?.name;
}

async function fetchAllTasks(token: string): Promise<CuTask[]> {
  const out: CuTask[] = [];
  for (let page = 0; page < 50; page++) {
    const url =
      `https://api.clickup.com/api/v2/list/${LIST_ID}/task` +
      `?page=${page}&include_closed=true&subtasks=false`;
    const res = await fetch(url, { headers: { Authorization: token } });
    if (!res.ok) {
      throw new Error(`ClickUp ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const body = (await res.json()) as { tasks: CuTask[]; last_page?: boolean };
    out.push(...(body.tasks ?? []));
    if (body.last_page || (body.tasks ?? []).length === 0) break;
  }
  return out;
}

// ─── Mapeamento ─────────────────────────────────────────────────────────────

const CICLO: Record<string, string> = { Mensal: "MENSAL", Anual: "ANUAL" };

/**
 * Nome do cliente: tira o detalhe entre colchetes, que descreve o CONTRATO e
 * não a empresa ("TIAGO LIMA [WOLF Security]" → cliente TIAGO LIMA). O detalhe
 * sobrevive no rótulo do contrato, então nada se perde.
 */
function nomeCliente(taskName: string): string {
  return taskName.replace(/\s*\[[^\]]*\]\s*/g, " ").replace(/\s+/g, " ").trim();
}

function detalheColchetes(taskName: string): string | undefined {
  const m = taskName.match(/\[([^\]]+)\]/);
  return m?.[1]?.trim();
}

interface Mapeado {
  taskId: string;
  taskUrl: string;
  cliente: string;
  label: string;
  amountCents: number | null;
  billingCycle: string;
  billingDay: number | null;
  status: string;
  url?: string;
  notes?: string;
  categoria: string;
}

function mapear(t: CuTask): Mapeado {
  const servico = dropdown(t, "SERVICO");
  const detalhe = detalheColchetes(t.name);
  const label = [servico ?? t.status, detalhe].filter(Boolean).join(" — ");

  const valorRaw = field(t, "Valor")?.value;
  const valor = valorRaw !== undefined && valorRaw !== null ? Number(valorRaw) : NaN;

  const diaRaw = text(t, "DIA VENCIMENTO");
  const dia = diaRaw ? parseInt(diaRaw.replace(/\D/g, ""), 10) : NaN;

  const situacao = dropdown(t, "Status");
  const notes = [
    text(t, "Descritivo") && `Descritivo: ${text(t, "Descritivo")}`,
    text(t, "Anotações") && `Anotações: ${text(t, "Anotações")}`,
    t.text_content?.trim() && `Observações do ClickUp:\n${t.text_content.trim()}`,
    situacao && `Situação no ClickUp: ${situacao}`,
    `Origem: ${t.custom_id ?? t.id} — ${t.url}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    taskId: t.id,
    taskUrl: t.url,
    cliente: nomeCliente(t.name),
    label: label || "Contrato mensal",
    amountCents: Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) : null,
    billingCycle: CICLO[dropdown(t, "Periodicidade") ?? "Mensal"] ?? "MENSAL",
    billingDay: Number.isFinite(dia) && dia >= 1 && dia <= 31 ? dia : null,
    // "Aguardando" = ainda não está cobrando; não entra na previsão do mês.
    status: situacao === "Aguardando" ? "EM_IMPLANTACAO" : "ATIVO",
    url: text(t, "Url"),
    notes,
    categoria: t.status,
  };
}

// ─── Empresas-cliente ───────────────────────────────────────────────────────

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

async function uniqueSlug(base: string) {
  let slug = base || `cliente-${Math.random().toString(36).slice(2, 8)}`;
  let n = 0;
  while (await prisma.company.findUnique({ where: { slug } })) slug = `${base}-${++n}`;
  return slug;
}

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const agencyId =
    opt("empresa") ??
    (await prisma.company.findFirst({ where: { parentCompanyId: null }, orderBy: { createdAt: "asc" } }))?.id;
  if (!agencyId) throw new Error("Nenhuma agência encontrada. Passe --empresa <companyId>.");
  const agency = await prisma.company.findUnique({ where: { id: agencyId }, select: { name: true } });

  const token =
    process.env.CLICKUP_API_TOKEN?.trim() ||
    (await prisma.setting.findUnique({ where: { key: `clickup_api_token:${agencyId}` } }))?.value?.trim();
  if (!token) {
    throw new Error(
      "Sem token do ClickUp. Defina CLICKUP_API_TOKEN no ambiente ou configure a integração da empresa."
    );
  }

  console.log(`Agência: ${agency?.name} (${agencyId})`);
  console.log(`Lista ClickUp: ${LIST_ID}\n`);

  const tasks = await fetchAllTasks(token);
  console.log(`${tasks.length} task(s) na lista.`);

  const vivas = tasks.filter((t) => INCLUIR_ENCERRADOS || !STATUS_MORTOS.has(t.status));
  const mortas = tasks.length - vivas.length;
  if (mortas > 0) {
    console.log(`${mortas} encerrada(s)/finalizada(s) ${INCLUIR_ENCERRADOS ? "incluída(s)" : "ignorada(s)"}.`);
  }

  const itens = vivas.map(mapear);

  // ── Relatório ────────────────────────────────────────────────────────────
  const porCategoria = new Map<string, { n: number; cents: number }>();
  let semValor = 0;
  let semDia = 0;
  let mrr = 0;
  for (const i of itens) {
    const cur = porCategoria.get(i.categoria) ?? { n: 0, cents: 0 };
    cur.n++;
    cur.cents += i.amountCents ?? 0;
    porCategoria.set(i.categoria, cur);
    if (i.amountCents === null) semValor++;
    if (i.billingDay === null) semDia++;
    if (i.amountCents) mrr += i.billingCycle === "ANUAL" ? Math.round(i.amountCents / 12) : i.amountCents;
  }

  console.log("\n── Por categoria ──");
  for (const [cat, v] of [...porCategoria].sort((a, b) => b[1].cents - a[1].cents)) {
    console.log(`  ${cat.padEnd(20)} ${String(v.n).padStart(3)} contrato(s)   ${brl(v.cents).padStart(14)}`);
  }
  console.log(`\n  Recorrência equivalente mensal: ${brl(mrr)}`);
  if (semValor) console.log(`  ⚠ ${semValor} contrato(s) SEM valor — não entram na previsão até preencher.`);
  if (semDia) console.log(`  ⚠ ${semDia} sem dia de vencimento.`);

  // Clientes que aparecem com nomes muito parecidos: provável duplicata.
  const porCliente = new Map<string, number>();
  for (const i of itens) porCliente.set(i.cliente, (porCliente.get(i.cliente) ?? 0) + 1);
  const nomes = [...porCliente.keys()].sort();
  const suspeitos: string[] = [];
  for (let a = 0; a < nomes.length; a++) {
    for (let b = a + 1; b < nomes.length; b++) {
      const x = nomes[a].toUpperCase();
      const y = nomes[b].toUpperCase();
      if (x !== y && (y.startsWith(x) || x.startsWith(y))) suspeitos.push(`${nomes[a]}  ~  ${nomes[b]}`);
    }
  }
  console.log(`\n  ${porCliente.size} cliente(s) distinto(s).`);
  if (suspeitos.length) {
    console.log(`  ⚠ ${suspeitos.length} par(es) de nome parecido — confira se é a mesma empresa:`);
    for (const s of suspeitos.slice(0, 15)) console.log(`      ${s}`);
    if (suspeitos.length > 15) console.log(`      … e mais ${suspeitos.length - 15}`);
  }

  // ── Casamento com quem já está cadastrado ────────────────────────────────
  // O dry-run precisa mostrar isto ANTES de gravar: casar por nome é frágil
  // ("TECNURBE ... LTDA." não casa com um "Tecnurbe" já cadastrado), e um
  // falso-negativo vira empresa duplicada na carteira.
  const jaCadastrados: { clickup: string; sistema: string; temCnpj: boolean }[] = [];
  const aCriar: string[] = [];
  for (const nome of nomes) {
    const existente = await prisma.company.findFirst({
      where: { parentCompanyId: agencyId, name: { equals: nome, mode: "insensitive" } },
      select: { name: true, document: true },
    });
    if (existente) {
      jaCadastrados.push({ clickup: nome, sistema: existente.name, temCnpj: !!existente.document });
    } else {
      aCriar.push(nome);
    }
  }
  console.log(`\n  ${jaCadastrados.length} já cadastrado(s) no sistema · ${aCriar.length} serão criados.`);
  const semCnpj = jaCadastrados.filter((c) => !c.temCnpj).length;
  if (semCnpj || aCriar.length) {
    // Company.document é a chave de casamento com o Bling (ver schema.prisma).
    // Sem ele, o sync do Bling não reconhece o cliente e duplica cadastro.
    console.log(
      `  ⚠ ${semCnpj + aCriar.length} cliente(s) ficarão SEM CNPJ — o vínculo com o Bling depende disso.`
    );
  }

  if (!APPLY) {
    if (aCriar.length) {
      console.log("\n── Clientes que serão criados (primeiros 20) ──");
      for (const n of aCriar.slice(0, 20)) console.log(`  + ${n}`);
      if (aCriar.length > 20) console.log(`  … e mais ${aCriar.length - 20}`);
    }
    console.log("\n── Amostra (10 primeiros) ──");
    for (const i of itens.slice(0, 10)) {
      console.log(
        `  ${i.cliente.slice(0, 34).padEnd(36)} ${i.label.slice(0, 30).padEnd(32)} ` +
        `${(i.amountCents ? brl(i.amountCents) : "—").padStart(12)}  dia ${i.billingDay ?? "—"}  ${i.billingCycle}`
      );
    }
    console.log("\nDry-run. Rode com --apply pra gravar.");
    return;
  }

  // ── Gravação ─────────────────────────────────────────────────────────────
  let criados = 0;
  let atualizados = 0;
  let clientesNovos = 0;

  for (const i of itens) {
    let company = await prisma.company.findFirst({
      where: { parentCompanyId: agencyId, name: { equals: i.cliente, mode: "insensitive" } },
      select: { id: true },
    });
    if (!company) {
      company = await prisma.company.create({
        data: {
          name: i.cliente,
          slug: await uniqueSlug(slugify(i.cliente)),
          parentCompanyId: agencyId,
          hasSystemAccess: false,
        },
        select: { id: true },
      });
      clientesNovos++;
    }

    const dados = {
      clientCompanyId: company.id,
      label: i.label,
      status: i.status,
      isRecurring: true,
      amountCents: i.amountCents,
      billingCycle: i.billingCycle,
      billingDay: i.billingDay,
      url: i.url ?? null,
      notes: i.notes ?? null,
      provider: "clickup",
      externalId: i.taskId,
    };

    const existente = await prisma.clientService.findFirst({
      where: { provider: "clickup", externalId: i.taskId },
      select: { id: true },
    });
    if (existente) {
      await prisma.clientService.update({ where: { id: existente.id }, data: dados });
      atualizados++;
    } else {
      await prisma.clientService.create({ data: dados });
      criados++;
    }
  }

  console.log(
    `\n${criados} contrato(s) criado(s), ${atualizados} atualizado(s), ` +
    `${clientesNovos} cliente(s) novo(s) cadastrado(s).`
  );
}

main()
  .catch((e) => { console.error("\n✖", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
