/**
 * Importação da lista "Contratos Mensais" do ClickUp para os contratos do
 * Financeiro (ClientService).
 *
 * Mora numa lib porque tem DOIS consumidores: o script
 * (scripts/import-clickup-contratos.ts) e a tela em /financeiro/importar.
 * Se o mapeamento vivesse só no script, a tela reimplementaria a regra e as
 * duas divergiriam no primeiro ajuste.
 *
 * MAPEAMENTO (campos personalizados da lista)
 *   Valor (currency)         → amountCents
 *   Periodicidade (dropdown) → billingCycle  (Mensal → MENSAL, Anual → ANUAL)
 *   DIA VENCIMENTO (texto)   → billingDay
 *   SERVICO (dropdown)       → rótulo (cai no status da task se vazio)
 *   Status (dropdown)        → Aguardando → EM_IMPLANTACAO; resto → ATIVO
 *   Url / Descritivo / Anotações → url e notes
 *   status da task           → categoria; encerrados/finalizado ficam de fora
 *
 * IDEMPOTENTE: casa por (provider="clickup", externalId=<id da task>).
 */

import { prisma } from "./prisma";

export const LISTA_CONTRATOS_PADRAO = "900100018035";

/** Status de task que significam contrato morto — fora da previsão. */
const STATUS_MORTOS = new Set(["encerrados", "finalizado"]);

const CICLO: Record<string, string> = { Mensal: "MENSAL", Anual: "ANUAL" };

interface CuField {
  id: string;
  name: string;
  type: string;
  value?: unknown;
  type_config?: { options?: { name: string; orderindex: number }[] };
}

/**
 * `status` chega em DUAS formas. A API REST v2 devolve um objeto
 * (`{status: "hospedagem", color, type, orderindex}`); as ferramentas MCP do
 * ClickUp já entregam achatado como string. Aceitar as duas evita que a origem
 * do dado mude o comportamento — foi exatamente essa diferença que passou
 * batida: montei o teste com o payload do MCP e o servidor recebia o da REST,
 * onde `t.status` virava "[object Object]" e o filtro de encerrados nunca
 * pegava ninguém.
 */
type CuStatus = string | { status?: string; type?: string };

export interface CuTask {
  id: string;
  custom_id?: string;
  name: string;
  status: CuStatus;
  url: string;
  text_content?: string;
  custom_fields: CuField[];
}

/** Nome do status, seja qual for a forma em que ele veio. */
export function statusNome(t: CuTask): string {
  const s = t.status;
  return (typeof s === "string" ? s : s?.status ?? "").trim();
}

/** Tipo do status no ClickUp ("closed", "done", "custom"…), quando disponível. */
function statusTipo(t: CuTask): string {
  return typeof t.status === "string" ? "" : (t.status?.type ?? "");
}

function field(t: CuTask, name: string): CuField | undefined {
  return t.custom_fields?.find((f) => f.name === name);
}

function text(t: CuTask, name: string): string | undefined {
  const v = field(t, name)?.value;
  const s = typeof v === "string" ? v.trim() : "";
  return s || undefined;
}

/** Dropdown do ClickUp vem como orderindex, não como rótulo. */
function dropdown(t: CuTask, name: string): string | undefined {
  const f = field(t, name);
  if (f?.value === undefined || f.value === null) return undefined;
  const idx = Number(f.value);
  return (f.type_config?.options ?? []).find((o) => o.orderindex === idx)?.name;
}

/** Teto de páginas. 100 tasks por página — 20 páginas cobrem 2000 contratos. */
const MAX_PAGINAS = 20;

/**
 * Páginas buscadas ao mesmo tempo. Baixo de propósito: o ClickUp limita
 * requisições por minuto e uma rajada leva 429 — que era rejeição rápida,
 * justamente o que derrubava tudo em ~1s.
 */
const LOTE = 3;

/**
 * Orçamento total da leitura. Existe pra SEMPRE responder antes do proxy
 * desistir: estourando isto, a página mostra um erro explicativo, em vez de
 * a conexão morrer e o navegador exibir "This page couldn't load" — que não
 * diz nada a ninguém.
 */
const ORCAMENTO_MS = 25_000;

/** `ultima` separado das tasks: página cheia PODE ser a última, e misturar os
 *  dois num só valor de retorno já me fez perder o fim da lista uma vez. */
async function buscarPagina(
  token: string,
  listId: string,
  page: number,
  incluirFechadas: boolean
): Promise<{ tasks: CuTask[]; ultima: boolean }> {
  const res = await fetch(
    `https://api.clickup.com/api/v2/list/${listId}/task` +
      `?page=${page}&include_closed=${incluirFechadas}&subtasks=false`,
    { headers: { Authorization: token }, signal: AbortSignal.timeout(20_000) }
  );
  if (!res.ok) {
    throw new Error(`ClickUp respondeu ${res.status} na página ${page}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = (await res.json()) as { tasks?: CuTask[]; last_page?: boolean };
  const tasks = body.tasks ?? [];
  return { tasks, ultima: body.last_page === true || tasks.length < 100 };
}

/**
 * Lê a lista inteira em lotes PARALELOS.
 *
 * Era sequencial — pede página 0, espera, pede a 1, espera. Com várias páginas
 * isso somava dezenas de segundos e a requisição morria no proxy antes de
 * responder qualquer coisa. Como a API do ClickUp aceita pedir uma página
 * arbitrária, dá pra buscar cinco de uma vez: o tempo passa a ser o da página
 * mais lenta do lote, não a soma de todas.
 */
export async function fetchContratos(
  token: string,
  listId: string,
  incluirFechadas = false
): Promise<CuTask[]> {
  const t0 = Date.now();
  const out: CuTask[] = [];

  for (let inicio = 0; inicio < MAX_PAGINAS; inicio += LOTE) {
    if (Date.now() - t0 > ORCAMENTO_MS) {
      throw new Error(
        `A leitura do ClickUp passou de ${ORCAMENTO_MS / 1000}s (${out.length} contratos lidos). ` +
        `A lista pode estar grande demais para ler de uma vez — use o script no servidor: npm run import:contratos-clickup`
      );
    }

    const paginas = Array.from({ length: LOTE }, (_, k) => inicio + k).filter((n) => n < MAX_PAGINAS);

    // allSettled, NUNCA all: com `Promise.all`, a primeira rejeição escapa e as
    // irmãs seguem voando sem ninguém escutando. Quando uma delas falha depois,
    // vira unhandled rejection — e no Node isso derruba o processo. A conexão
    // morria inteira e o navegador só dizia "This page couldn't load".
    const lote = await Promise.allSettled(
      paginas.map((n) => buscarPagina(token, listId, n, incluirFechadas))
    );

    const falhas = lote.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    if (falhas.length === lote.length) {
      const motivo = falhas[0].reason;
      const msg = motivo instanceof Error ? motivo.message : String(motivo);
      throw new Error(
        msg.includes("429")
          ? `O ClickUp recusou por excesso de requisições (429). Tente de novo em um minuto. Detalhe: ${msg}`
          : msg
      );
    }
    // Falha parcial não invalida o lote — registra e segue com o que veio.
    for (const f of falhas) {
      console.warn(`[Contratos ClickUp] página falhou e foi ignorada: ${(f.reason as Error)?.message ?? f.reason}`);
    }

    let acabou = falhas.length > 0; // não dá pra confiar na sequência após um buraco
    for (const r of lote) {
      if (r.status !== "fulfilled") continue;
      out.push(...r.value.tasks);
      if (r.value.ultima) acabou = true;
    }
    console.log(
      `[Contratos ClickUp] lote ${inicio}-${inicio + LOTE - 1}: ${out.length} task(s) acumulada(s), ${Date.now() - t0}ms`
    );
    if (acabou) break;
  }

  console.log(`[Contratos ClickUp] ${out.length} task(s) em ${Date.now() - t0}ms`);
  return out;
}

/**
 * Nome do cliente: tira o detalhe entre colchetes, que descreve o CONTRATO e
 * não a empresa ("TIAGO LIMA [WOLF Security]" → TIAGO LIMA). O detalhe
 * sobrevive no rótulo do contrato, então nada se perde.
 */
export function nomeCliente(taskName: string): string {
  return taskName.replace(/\s*\[[^\]]*\]\s*/g, " ").replace(/\s+/g, " ").trim();
}

export interface ContratoMapeado {
  taskId: string;
  taskUrl: string;
  codigo: string;
  cliente: string;
  label: string;
  amountCents: number | null;
  billingCycle: string;
  billingDay: number | null;
  status: string;
  categoria: string;
  url?: string;
  notes?: string;
}

export function mapearContrato(t: CuTask): ContratoMapeado {
  const servico = dropdown(t, "SERVICO");
  const detalhe = t.name.match(/\[([^\]]+)\]/)?.[1]?.trim();
  const valorRaw = field(t, "Valor")?.value;
  const valor = valorRaw !== undefined && valorRaw !== null ? Number(valorRaw) : NaN;
  const diaRaw = text(t, "DIA VENCIMENTO");
  const dia = diaRaw ? parseInt(diaRaw.replace(/\D/g, ""), 10) : NaN;
  const situacao = dropdown(t, "Status");
  const nomeStatus = statusNome(t);

  return {
    taskId: t.id,
    taskUrl: t.url,
    codigo: t.custom_id ?? t.id,
    cliente: nomeCliente(t.name),
    label: [servico ?? nomeStatus, detalhe].filter(Boolean).join(" — ") || "Contrato mensal",
    amountCents: Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) : null,
    billingCycle: CICLO[dropdown(t, "Periodicidade") ?? "Mensal"] ?? "MENSAL",
    billingDay: Number.isFinite(dia) && dia >= 1 && dia <= 31 ? dia : null,
    status: situacao === "Aguardando" ? "EM_IMPLANTACAO" : "ATIVO",
    categoria: nomeStatus || "sem status",
    url: text(t, "Url"),
    notes: [
      text(t, "Descritivo") && `Descritivo: ${text(t, "Descritivo")}`,
      text(t, "Anotações") && `Anotações: ${text(t, "Anotações")}`,
      t.text_content?.trim() && `Observações do ClickUp:\n${t.text_content.trim()}`,
      situacao && `Situação no ClickUp: ${situacao}`,
      `Origem: ${t.custom_id ?? t.id} — ${t.url}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function filtrarVivos(tasks: CuTask[], incluirEncerrados: boolean) {
  if (incluirEncerrados) return tasks;
  return tasks.filter((t) => {
    // O tipo do ClickUp é a fonte mais confiável; o nome cobre "encerrados",
    // que é status personalizado do tipo "done" nesta lista.
    if (statusTipo(t) === "closed") return false;
    return !STATUS_MORTOS.has(statusNome(t).toLowerCase());
  });
}

// ─── Relatório ──────────────────────────────────────────────────────────────

export interface RelatorioImportacao {
  totalTasks: number;
  encerradas: number;
  contratos: number;
  mrrCents: number;
  semValor: number;
  semDia: number;
  porCategoria: { categoria: string; n: number; cents: number }[];
  /** Nome do ClickUp que casou com empresa já cadastrada. */
  clientesExistentes: { clickup: string; empresaId: string; empresaNome: string; temCnpj: boolean }[];
  /**
   * Nome que hoje viraria empresa nova — com os candidatos parecidos que já
   * existem na carteira. É a lista pra conferir ANTES de gravar: casar por nome
   * exato erra, e o erro vira empresa duplicada.
   */
  clientesNovos: { nome: string; parecidos: { id: string; nome: string }[] }[];
  nomesParecidos: [string, string][];
  itens: ContratoMapeado[];
}

/**
 * Normaliza razão social pra comparação: sem acento, sem pontuação e sem os
 * sufixos jurídicos que só existem no cadastro formal ("TECNURBE ... LTDA." e
 * "Tecnurbe" são a mesma empresa pro olho humano, e precisam ser pro código).
 */
const SUFIXOS = /\b(LTDA|ME|EPP|EIRELI|S\/?A|SA|MEI|CIA|COMERCIO|COM|IND|INDUSTRIA)\b/g;

export function normalizarNome(nome: string): string {
  return nome
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(SUFIXOS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Dois nomes provavelmente são a mesma empresa? Deliberadamente conservador:
 * sugere, nunca casa sozinho. Um falso positivo automático juntaria clientes
 * diferentes na mesma carteira, o que é pior que um cadastro duplicado.
 */
/** Primeiras palavras que descrevem o RAMO, não a empresa. */
const GENERICAS = new Set([
  "CLINICA", "INSTITUTO", "ESCOLA", "COLEGIO", "CENTRO", "ACADEMIA", "OTICA",
  "PETSHOP", "IMOBILIARIA", "CONSTRUTORA", "TRANSPORTADORA", "MERCADO",
  "PADARIA", "FARMACIA", "HOTEL", "POUSADA", "RESTAURANTE", "CHURRASCARIA",
  "HAMBURGUERIA", "CONSULTORIA", "ADVOCACIA", "AGENCIA", "ASSOCIACAO",
  "FUNDACAO", "CONSORCIO", "MUNICIPIO", "CAMARA", "PROGRAMA", "GRUPO",
  "EMPRESA", "CASA", "LOJA", "SALAO", "ESTUDIO", "STUDIO", "ESPACO",
  "SISTEMA", "SERVICOS", "SOLUCOES", "DISTRIBUIDORA",
]);

export function pareceMesmaEmpresa(a: string, b: string): boolean {
  const x = normalizarNome(a);
  const y = normalizarNome(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // Um é começo do outro, respeitando limite de palavra ("CEFERP" ⊂ "CEFERP CENTRO").
  if (x.startsWith(y + " ") || y.startsWith(x + " ")) return true;
  // Primeira palavra igual só vale se ela for distintiva. "CLINICA VIDA PLENA"
  // e "CLINICA INFANTIL" são clientes diferentes; o que as une é o ramo, não a
  // identidade.
  const pa = x.split(" ")[0];
  const pb = y.split(" ")[0];
  return pa.length >= 5 && pa === pb && !GENERICAS.has(pa);
}

/**
 * Monta o retrato do que a importação faria. Roda ANTES de gravar porque casar
 * cliente por nome é frágil: um falso-negativo ("TECNURBE ... LTDA." não casa
 * com um "Tecnurbe" já cadastrado) vira empresa duplicada na carteira, e isso
 * é bem mais chato de desfazer do que de evitar.
 */
export async function analisarImportacao(
  agencyId: string,
  tasks: CuTask[],
  incluirEncerrados: boolean
): Promise<RelatorioImportacao> {
  const vivos = filtrarVivos(tasks, incluirEncerrados);
  const itens = vivos.map(mapearContrato);

  const cat = new Map<string, { n: number; cents: number }>();
  let mrrCents = 0;
  let semValor = 0;
  let semDia = 0;
  for (const i of itens) {
    const cur = cat.get(i.categoria) ?? { n: 0, cents: 0 };
    cur.n++;
    cur.cents += i.amountCents ?? 0;
    cat.set(i.categoria, cur);
    if (i.amountCents === null) semValor++;
    if (i.billingDay === null) semDia++;
    if (i.amountCents) {
      mrrCents += i.billingCycle === "ANUAL" ? Math.round(i.amountCents / 12) : i.amountCents;
    }
  }

  const nomes = [...new Set(itens.map((i) => i.cliente))].sort();
  const existentes = await prisma.company.findMany({
    where: { parentCompanyId: agencyId },
    select: { id: true, name: true, document: true },
  });
  const porNome = new Map(existentes.map((c) => [c.name.toUpperCase(), c] as const));

  const clientesExistentes: RelatorioImportacao["clientesExistentes"] = [];
  const clientesNovos: RelatorioImportacao["clientesNovos"] = [];
  // Vínculos já estabelecidos: nome de origem que uma importação anterior
  // resolveu. Sobrevive a mesclagem, porque o contrato migra junto com a
  // empresa. É o que faz a prévia parar de anunciar como "novo" um cliente
  // que você já resolveu na mão.
  const vinculados = new Map<string, { id: string; name: string; document: string | null }>();
  for (const v of await prisma.clientService.findMany({
    where: { provider: "clickup", externalClientName: { in: nomes } },
    select: { externalClientName: true, clientCompany: { select: { id: true, name: true, document: true } } },
  })) {
    if (v.externalClientName && v.clientCompany) vinculados.set(v.externalClientName, v.clientCompany);
  }

  for (const n of nomes) {
    const exato = porNome.get(n.toUpperCase()) ?? vinculados.get(n);
    if (exato) {
      clientesExistentes.push({
        clickup: n,
        empresaId: exato.id,
        empresaNome: exato.name,
        temCnpj: !!exato.document,
      });
      continue;
    }
    // Sem casamento exato, procura semelhantes na carteira. Só sugere — o
    // vínculo continua sendo decisão humana, porque juntar clientes diferentes
    // por engano é pior que criar um cadastro duplicado.
    const parecidos = existentes
      .filter((c) => pareceMesmaEmpresa(n, c.name))
      .map((c) => ({ id: c.id, nome: c.name }));
    clientesNovos.push({ nome: n, parecidos });
  }

  // Prefixo comum = provável mesma empresa cadastrada duas vezes.
  const nomesParecidos: [string, string][] = [];
  for (let a = 0; a < nomes.length; a++) {
    for (let b = a + 1; b < nomes.length; b++) {
      const x = nomes[a].toUpperCase();
      const y = nomes[b].toUpperCase();
      if (x !== y && (y.startsWith(x) || x.startsWith(y))) nomesParecidos.push([nomes[a], nomes[b]]);
    }
  }

  return {
    totalTasks: tasks.length,
    encerradas: tasks.length - vivos.length,
    contratos: itens.length,
    mrrCents,
    semValor,
    semDia,
    porCategoria: [...cat].map(([categoria, v]) => ({ categoria, ...v })).sort((a, b) => b.cents - a.cents),
    clientesExistentes,
    clientesNovos,
    nomesParecidos,
    itens,
  };
}

// ─── Gravação ───────────────────────────────────────────────────────────────

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

export async function aplicarImportacao(
  agencyId: string,
  itens: ContratoMapeado[]
): Promise<{ criados: number; atualizados: number; clientesNovos: number }> {
  let criados = 0;
  let atualizados = 0;
  let clientesNovos = 0;

  for (const i of itens) {
    // Contrato que já foi importado antes: o vínculo com a empresa é decisão
    // humana (pode ter havido mesclagem depois), então NÃO se mexe nele.
    const existente = await prisma.clientService.findFirst({
      where: { provider: "clickup", externalId: i.taskId },
      select: { id: true, clientCompanyId: true },
    });

    // Task nova, mas de um cliente cujo nome de origem já foi resolvido antes.
    // É o que impede a duplicata de renascer depois de uma mesclagem.
    const porNomeDeOrigem = existente
      ? null
      : await prisma.clientService.findFirst({
          where: { provider: "clickup", externalClientName: i.cliente },
          select: { clientCompanyId: true },
        });

    let company: { id: string } | null = existente
      ? { id: existente.clientCompanyId }
      : porNomeDeOrigem
        ? { id: porNomeDeOrigem.clientCompanyId }
        : await prisma.company.findFirst({
            where: { parentCompanyId: agencyId, name: { equals: i.cliente, mode: "insensitive" } },
            select: { id: true },
          });
    if (!company) {
      const base = slugify(i.cliente) || "cliente";
      let slug = base;
      let n = 0;
      while (await prisma.company.findUnique({ where: { slug } })) slug = `${base}-${++n}`;
      company = await prisma.company.create({
        data: { name: i.cliente, slug, parentCompanyId: agencyId, hasSystemAccess: false },
        select: { id: true },
      });
      clientesNovos++;
    }

    const dados = {
      clientCompanyId: company.id,
      externalClientName: i.cliente,
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

    if (existente) {
      await prisma.clientService.update({ where: { id: existente.id }, data: dados });
      atualizados++;
    } else {
      await prisma.clientService.create({ data: dados });
      criados++;
    }
  }

  return { criados, atualizados, clientesNovos };
}
