/**
 * Sync Bling ↔ LeadHub (Fase 1). Chamado pelo botão "Sincronizar agora" e pelo
 * cron diário (/api/cron/bling-sync). `companyId` = a empresa que conectou o
 * Bling (a AZZ). As sub-empresas dela (parentCompanyId = companyId) são os
 * "clientes".
 *
 * Regras definidas com o Diego:
 *   - Cadastro de clientes é MÃO DUPLA:
 *       • contato no Bling e não aqui  → cria sub-empresa da AZZ
 *       • cliente aqui e não no Bling  → cria contato no Bling
 *       • existe nos dois              → casa por CNPJ e vincula (blingContactId)
 *   - NUNCA sobrescreve dados de quem já existe (só preenche o que falta:
 *     blingContactId / document). Regra de conflito fica pra depois.
 *   - Chave de casamento: CNPJ/CPF (só dígitos) em Company.document.
 *   - Boletos (contas a receber) + NF: só ENTRAM (read-only) no financeiro
 *     (ClientInvoice, provider="bling"). Não emitimos nota nem cobrança pelo
 *     LeadHub nesta fase.
 */

import { prisma } from "./prisma";
import {
  listContatos,
  listContasReceber,
  listNfe,
  createContato,
  onlyDigits,
  type BlingContato,
} from "./bling";

// ── Helpers ─────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 40) || "cliente";
}

/** Gera um slug único pra sub-empresa nova (base do nome + fallback com o id Bling). */
async function uniqueSlug(name: string, blingId: number): Promise<string> {
  const base = slugify(name);
  const taken = await prisma.company.findUnique({ where: { slug: base }, select: { id: true } });
  return taken ? `${base}-${blingId}` : base;
}

/**
 * Decide se um contato do Bling é "cliente". A estrutura de `tiposContato` pode
 * variar entre contas — tratamos de forma lenient: é cliente se algum tipo
 * casar /cliente/i, OU se não vier informação de tipo (fallback: a maioria dos
 * contatos num ERP pequeno é cliente). ⚠️ Confirmar no 1º sync com dados reais;
 * se puxar fornecedor demais, apertar este filtro.
 */
function isCliente(c: BlingContato): boolean {
  const tipos = c.tiposContato;
  if (!tipos || tipos.length === 0) return true;
  return tipos.some((t) => /cliente/i.test(t?.descricao ?? ""));
}

/** Mapeia a situação de uma conta a receber do Bling → status do ClientInvoice. */
function mapContaStatus(situacao: number | string | undefined): "ABERTO" | "PAGO" | "CANCELADO" {
  const s = String(situacao ?? "").toLowerCase();
  // Numérico (Bling v3): 2=recebido, 4=baixado → PAGO; 5=cancelado → CANCELADO.
  if (s === "2" || s === "4" || /receb|baix|pag|quit/.test(s)) return "PAGO";
  if (s === "5" || /cancel/.test(s)) return "CANCELADO";
  return "ABERTO";
}

function toCents(valor: number | undefined): number {
  if (!Number.isFinite(valor as number)) return 0;
  return Math.round((valor as number) * 100);
}

function parseDate(d: string | undefined): Date | null {
  if (!d) return null;
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

// ── 1) Cadastro de clientes (mão dupla) ─────────────────────────────────────

export interface ClientSyncResult {
  createdHere: number; // sub-empresas criadas a partir do Bling
  linkedHere: number; // empresas existentes que ganharam vínculo blingContactId
  createdInBling: number; // contatos criados no Bling a partir do LeadHub
  skipped: number; // pulados (sem nome/documento etc.)
}

// Plano de sincronização de clientes: o que SERIA feito (sem gravar). É a fonte
// única de decisão — o dry-run (previewClientes) mostra este plano, e o sync
// real (syncClientes) executa exatamente ele. Assim preview e execução nunca
// divergem.
export interface ClientPlan {
  toCreateHere: { blingId: string; nome: string; doc: string | null }[];
  toLinkHere: { companyId: string; companyName: string; blingId: string; doc: string | null; fillDoc: boolean }[];
  toFillDocHere: { companyId: string; companyName: string; doc: string }[];
  toCreateInBling: { companyId: string; companyName: string; doc: string }[];
  skippedNoDoc: { companyName: string }[]; // cliente daqui sem CNPJ → não dá pra casar/criar no Bling
  nonClientContacts: number; // contatos do Bling ignorados (não-cliente)
  alreadyLinked: number; // já casados (nada a fazer)
}

/**
 * Calcula o plano de sync de clientes SEM gravar nada. Detalhes das regras no
 * cabeçalho do arquivo (mão dupla, casa por CNPJ, nunca sobrescreve).
 */
async function planClientes(companyId: string): Promise<ClientPlan> {
  const plan: ClientPlan = {
    toCreateHere: [], toLinkHere: [], toFillDocHere: [], toCreateInBling: [],
    skippedNoDoc: [], nonClientContacts: 0, alreadyLinked: 0,
  };

  const subCompanies = await prisma.company.findMany({
    where: { parentCompanyId: companyId },
    select: { id: true, name: true, document: true, blingContactId: true },
  });
  const byBlingId = new Map<string, (typeof subCompanies)[number]>();
  const byDoc = new Map<string, (typeof subCompanies)[number]>();
  for (const c of subCompanies) {
    if (c.blingContactId) byBlingId.set(c.blingContactId, c);
    const doc = onlyDigits(c.document);
    if (doc) byDoc.set(doc, c);
  }

  // ── Bling → LeadHub ──
  const contatos = await listContatos(companyId);
  const willLink = new Set<string>(); // ids de sub-empresas que vão ganhar vínculo

  for (const contato of contatos) {
    if (!isCliente(contato)) {
      plan.nonClientContacts++;
      continue;
    }
    const blingId = String(contato.id);
    const doc = onlyDigits(contato.numeroDocumento);
    const nome = (contato.nome ?? "").trim() || `Cliente ${blingId}`;

    // Já vinculado por blingContactId?
    const existingByBling = byBlingId.get(blingId);
    if (existingByBling) {
      plan.alreadyLinked++;
      if (!onlyDigits(existingByBling.document) && doc) {
        plan.toFillDocHere.push({ companyId: existingByBling.id, companyName: existingByBling.name, doc });
      }
      continue;
    }

    // Casa por CNPJ/CPF (e o par ainda não está vinculado a outro contato)?
    const existingByDoc = doc ? byDoc.get(doc) : undefined;
    if (existingByDoc && !existingByDoc.blingContactId) {
      plan.toLinkHere.push({
        companyId: existingByDoc.id,
        companyName: existingByDoc.name,
        blingId,
        doc: doc || null,
        fillDoc: !onlyDigits(existingByDoc.document) && !!doc,
      });
      existingByDoc.blingContactId = blingId; // guarda em memória p/ não recriar depois
      willLink.add(existingByDoc.id);
      continue;
    }
    // Conflito raro: mesmo CNPJ já vinculado a outro contato → não mexe.
    if (existingByDoc && existingByDoc.blingContactId) {
      plan.alreadyLinked++;
      continue;
    }

    // Não existe aqui → criar sub-empresa
    plan.toCreateHere.push({ blingId, nome, doc: doc || null });
  }

  // ── LeadHub → Bling ──
  for (const c of subCompanies) {
    if (c.blingContactId) continue; // já casado (inclui os marcados em memória acima)
    if (willLink.has(c.id)) continue;
    const doc = onlyDigits(c.document);
    if (!doc) {
      plan.skippedNoDoc.push({ companyName: c.name });
      continue;
    }
    plan.toCreateInBling.push({ companyId: c.id, companyName: c.name, doc });
  }

  return plan;
}

/** Dry-run: retorna o plano de clientes (nada é gravado). */
export function previewClientes(companyId: string): Promise<ClientPlan> {
  return planClientes(companyId);
}

export async function syncClientes(companyId: string): Promise<ClientSyncResult> {
  const res: ClientSyncResult = { createdHere: 0, linkedHere: 0, createdInBling: 0, skipped: 0 };
  const plan = await planClientes(companyId);

  // Guarda os contatos do Bling p/ recuperar email/telefone ao criar sub-empresa.
  const contatos = await listContatos(companyId);
  const contatoById = new Map(contatos.map((c) => [String(c.id), c]));

  // Preenche document faltante (sem sobrescrever nada).
  for (const f of plan.toFillDocHere) {
    await prisma.company.update({ where: { id: f.companyId }, data: { document: f.doc } });
  }

  // Vincula os casados por CNPJ.
  for (const l of plan.toLinkHere) {
    await prisma.company.update({
      where: { id: l.companyId },
      data: { blingContactId: l.blingId, ...(l.fillDoc && l.doc ? { document: l.doc } : {}) },
    });
    res.linkedHere++;
  }

  // Cria as sub-empresas novas a partir do Bling.
  for (const c of plan.toCreateHere) {
    const contato = contatoById.get(c.blingId);
    const slug = await uniqueSlug(c.nome, Number(c.blingId));
    await prisma.company.create({
      data: {
        name: c.nome,
        slug,
        parentCompanyId: companyId,
        document: c.doc,
        blingContactId: c.blingId,
        email: contato?.email || null,
        phone: contato?.celular || contato?.telefone || null,
      },
    });
    res.createdHere++;
  }

  // Cria no Bling os clientes daqui que não têm par.
  for (const c of plan.toCreateInBling) {
    const local = await prisma.company.findUnique({
      where: { id: c.companyId },
      select: { name: true, email: true, phone: true },
    });
    if (!local) continue;
    try {
      const newBlingId = await createContato(companyId, {
        nome: local.name,
        documento: c.doc,
        email: local.email ?? undefined,
        telefone: local.phone ?? undefined,
      });
      await prisma.company.update({ where: { id: c.companyId }, data: { blingContactId: String(newBlingId) } });
      res.createdInBling++;
    } catch (e: any) {
      console.error(`[bling-sync] falha ao criar contato no Bling p/ ${c.companyName}:`, e?.message);
      res.skipped++;
    }
  }

  res.skipped += plan.skippedNoDoc.length;
  return res;
}

// ── 2) Financeiro (boletos + NF) — read-only ────────────────────────────────

export interface FinanceSyncResult {
  boletos: number; // contas a receber importadas/atualizadas
  notas: number; // NF vinculadas (invoiceUrl setado numa cobrança)
  unmatched: number; // registros sem cliente correspondente no LeadHub
}

/** Índice blingContactId → id da sub-empresa no LeadHub. */
async function buildClientIndex(companyId: string): Promise<Map<string, string>> {
  const rows = await prisma.company.findMany({
    where: { parentCompanyId: companyId, blingContactId: { not: null } },
    select: { id: true, blingContactId: true },
  });
  const map = new Map<string, string>();
  for (const r of rows) if (r.blingContactId) map.set(r.blingContactId, r.id);
  return map;
}

export async function syncFinanceiro(companyId: string): Promise<FinanceSyncResult> {
  const res: FinanceSyncResult = { boletos: 0, notas: 0, unmatched: 0 };
  const clientIndex = await buildClientIndex(companyId);

  // ── Boletos (contas a receber) = as linhas de dinheiro do financeiro ──
  const contas = await listContasReceber(companyId);
  for (const conta of contas) {
    const blingClientId = conta.contato?.id != null ? String(conta.contato.id) : null;
    const clientCompanyId = blingClientId ? clientIndex.get(blingClientId) : undefined;
    if (!clientCompanyId) {
      res.unmatched++;
      continue; // sem cliente casado → não dá pra pendurar a cobrança
    }

    const externalId = `cr:${conta.id}`;
    const dueDate = parseDate(conta.vencimento) ?? new Date();
    const data = {
      clientCompanyId,
      description: (conta.historico ?? "").trim() || `Cobrança Bling #${conta.id}`,
      referenceMonth: conta.competencia ? String(conta.competencia).slice(0, 7) : null,
      amountCents: toCents(conta.valor),
      dueDate,
      status: mapContaStatus(conta.situacao),
      paidAt: parseDate(conta.dataPagamento),
      boletoUrl: conta.linkBoleto || null,
      externalId,
      provider: "bling",
    };

    const existing = await prisma.clientInvoice.findFirst({
      where: { provider: "bling", externalId },
      select: { id: true },
    });
    if (existing) {
      await prisma.clientInvoice.update({ where: { id: existing.id }, data });
    } else {
      await prisma.clientInvoice.create({ data });
    }
    res.boletos++;
  }

  // ── NF: anexa o link da nota (invoiceUrl) numa cobrança do mesmo cliente ──
  // Heurística Fase 1: casa por cliente + mesmo valor. A API básica não liga NF
  // ↔ conta a receber, então NF sem cobrança correspondente é só CONTABILIZADA
  // como unmatched (não cria linha de dinheiro nova pra não inflar o total).
  const notas = await listNfe(companyId);
  for (const nf of notas) {
    const blingClientId = nf.contato?.id != null ? String(nf.contato.id) : null;
    const clientCompanyId = blingClientId ? clientIndex.get(blingClientId) : undefined;
    const link = nf.linkDanfe || nf.linkPDF || null;
    if (!clientCompanyId || !link) {
      res.unmatched++;
      continue;
    }
    const valorCents = toCents(nf.valorNota);
    const match = await prisma.clientInvoice.findFirst({
      where: {
        clientCompanyId,
        provider: "bling",
        amountCents: valorCents,
        invoiceUrl: null,
      },
      orderBy: { dueDate: "desc" },
      select: { id: true },
    });
    if (match) {
      await prisma.clientInvoice.update({ where: { id: match.id }, data: { invoiceUrl: link } });
      res.notas++;
    } else {
      res.unmatched++;
    }
  }

  return res;
}

// ── Orquestração completa (clientes → financeiro) ───────────────────────────

export interface FullSyncResult {
  clients: ClientSyncResult;
  finance: FinanceSyncResult;
}

/**
 * Roda o sync completo pra uma empresa e grava a telemetria em BlingIntegration.
 * Ordem importa: clientes primeiro (cria/casa os vínculos), financeiro depois
 * (depende do blingContactId pra pendurar boleto/NF no cliente certo).
 */
export async function runBlingSync(companyId: string): Promise<FullSyncResult> {
  try {
    const clients = await syncClientes(companyId);
    const finance = await syncFinanceiro(companyId);

    await prisma.blingIntegration.update({
      where: { companyId },
      data: {
        status: "ACTIVE",
        lastSyncAt: new Date(),
        lastSyncStatus: "ok",
        lastError: null,
        lastClientsSynced: clients.createdHere + clients.linkedHere + clients.createdInBling,
        lastInvoicesSynced: finance.boletos + finance.notas,
      },
    });

    return { clients, finance };
  } catch (e: any) {
    await prisma.blingIntegration
      .update({
        where: { companyId },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: `error: ${e?.message?.slice(0, 200) ?? "erro"}`,
          lastError: e?.message?.slice(0, 500) ?? "erro",
          // status EXPIRED só é setado no getBlingAccessToken; aqui mantemos ERROR
          status: "ERROR",
        },
      })
      .catch(() => {});
    throw e;
  }
}
