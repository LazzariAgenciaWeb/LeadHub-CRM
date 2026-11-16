/**
 * Liga conversa do WhatsApp ↔ cliente (empresa da carteira da agência).
 *
 * Por que existe: o webhook grava um CompanyContact NA PRÓPRIA AGÊNCIA pra
 * cada contato/grupo, só pra guardar o nome (pushName / nome do grupo). A
 * lista de conversas tratava esse cache como "o cliente", e por isso grupos e
 * contatos de clientes apareciam como "AZZ Agência". Agora:
 *   - contato da PRÓPRIA empresa da conversa = só cache de nome (cliente
 *     indefinido);
 *   - cliente = CompanyContact numa sub-empresa (parentCompanyId = agência).
 *
 * Quando a conversa não tem cliente, sugerimos um, nesta ordem de força:
 *   1. contato cadastrado num cliente com o mesmo número (variações 55/9º dígito);
 *   2. telefone do cadastro do cliente;
 *   3. chamado aberto por este número/grupo ligado a um cliente;
 *   4. lead desta conversa cuja venda virou um cliente;
 *   5. nome do grupo/contato contém o nome do cliente.
 * Só sugere quando a resposta é UMA (empate = sem sugestão). Melhor "cliente
 * indefinido" que cliente errado.
 */

import { prisma } from "./prisma";
import { phoneMatchVariants } from "./phone-match";

// ─── Parte pura (testável sem banco) ─────────────────────────────────────────

export type SuggestionReason = "CONTATO" | "TELEFONE_CLIENTE" | "CHAMADO" | "VENDA" | "NOME" | "NOME_PARCIAL";

export const REASON_LABEL: Record<SuggestionReason, string> = {
  CONTATO: "contato cadastrado no cliente",
  TELEFONE_CLIENTE: "telefone do cadastro do cliente",
  CHAMADO: "chamado aberto por este número/grupo",
  VENDA: "venda fechada com este contato",
  NOME: "nome do grupo/contato bate com o cliente",
  NOME_PARCIAL: "nome do grupo/contato cita o cliente",
};

const REASON_SCORE: Record<SuggestionReason, number> = {
  CONTATO: 100,
  TELEFONE_CLIENTE: 90,
  CHAMADO: 80,
  VENDA: 70,
  NOME: 50,
  NOME_PARCIAL: 30,
};

export interface ClientRef {
  id: string;
  name: string;
  tradeName?: string | null;
}

export interface Signal {
  clientId: string;
  reason: SuggestionReason;
}

export interface ClientSuggestion {
  clientId: string;
  clientName: string;
  reasons: SuggestionReason[];
  score: number;
}

// Palavras que não identificam ninguém: conectivos, sufixo societário e o
// vocabulário de nome de grupo ("Financeiro", "Atendimento", "Equipe"…).
const STOPWORDS = new Set([
  "a", "o", "e", "de", "da", "do", "das", "dos", "em", "na", "no", "com", "por", "para", "pra", "the", "and", "x",
  "ltda", "me", "epp", "eireli", "sa", "s", "cia", "mei", "slu", "ss",
  "grupo", "equipe", "time", "atendimento", "financeiro", "suporte", "comercial", "marketing", "digital",
  "agencia", "cliente", "clientes", "projeto", "projetos", "oficial", "geral", "novo", "nova", "br", "com",
  // Ramo de negócio: sozinho não identifica ninguém ("Clínica …", "… Hotel").
  "clinica", "studio", "estudio", "casa", "instituto", "escritorio", "loja", "lojas", "restaurante", "hotel",
  "pousada", "academia", "escola", "centro", "consultorio", "farmacia", "imobiliaria", "advogados", "advocacia",
  "associados", "consultoria", "comercio", "servicos", "industria", "distribuidora", "empresa", "solucoes",
  "colegio", "laboratorio", "supermercado", "mercado", "auto", "pecas", "metais",
]);

// Primeiro nome sozinho não identifica cliente pessoa física: "Gustavo" não é
// o cliente GUSTAVO BARROS ALVES. Com esse primeiro token o nome parcial exige
// mais uma palavra em comum.
const FIRST_NAMES = new Set([
  "ana", "maria", "jose", "joao", "antonio", "francisco", "carlos", "paulo", "pedro", "lucas", "luiz", "luis",
  "marcos", "marcio", "marcelo", "gustavo", "rodrigo", "andre", "fernando", "rafael", "bruno", "eduardo",
  "felipe", "gabriel", "daniel", "leonardo", "mateus", "matheus", "vinicius", "guilherme", "ricardo", "sergio",
  "roberto", "diego", "thiago", "tiago", "claudio", "fabio", "flavio", "vitor", "victor", "igor", "alexandre",
  "leandro", "rogerio", "edson", "douglas", "jean", "william", "cesar", "erick", "eric", "gilson", "julio",
  "juliana", "fernanda", "patricia", "camila", "amanda", "mariana", "aline", "vanessa", "leticia", "larissa",
  "bruna", "julia", "beatriz", "gabriela", "adriana", "sandra", "marcia", "luciana", "cristina", "renata",
  "simone", "erica", "eliane", "kelly", "sabrina", "natalia", "priscila", "jessica", "tatiana", "carla",
  "thais", "paola", "paula", "marina", "clara", "sofia", "laura", "lara", "isabela", "debora", "monica",
]);

export function normalizeName(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function significantTokens(s: string | null | undefined, extraStop?: Set<string>): string[] {
  return normalizeName(s)
    .split(" ")
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t) && !(extraStop?.has(t)));
}

/**
 * Quanto o nome da conversa bate com o cliente:
 *   "NOME"         → todas as palavras que identificam o cliente aparecem;
 *   "NOME_PARCIAL" → a primeira palavra distintiva (≥4 letras) aparece;
 *   null           → nada.
 * `agencyStop` tira o nome da própria agência ("Bushatsky + AZZ Agência").
 */
export function nameMatch(convName: string, client: ClientRef, agencyStop: Set<string>): "NOME" | "NOME_PARCIAL" | null {
  const conv = new Set(significantTokens(convName, agencyStop));
  if (conv.size === 0) return null;
  let best: "NOME" | "NOME_PARCIAL" | null = null;
  for (const n of [client.tradeName, client.name]) {
    const toks = significantTokens(n, agencyStop);
    if (toks.length === 0) continue;
    if (toks.every((t) => conv.has(t)) && toks.some((t) => t.length >= 3)) return "NOME";
    // Parcial: o nome da conversa COMEÇA pela primeira palavra distintiva do
    // cliente ("Gamma Travel" ↔ "Gamma Turismo"); "Fort Metais" não casa
    // "Metais Cobra". Primeiro nome de pessoa precisa de mais uma em comum.
    const first = toks[0];
    const convFirst = significantTokens(convName, agencyStop)[0];
    const shared = toks.filter((t) => conv.has(t)).length;
    if (first.length >= 4 && first === convFirst && (shared >= 2 || !FIRST_NAMES.has(first))) best = "NOME_PARCIAL";
  }
  return best;
}

/**
 * Junta os sinais e decide. Cada cliente soma a MAIOR força de cada motivo;
 * o vencedor precisa abrir ao menos 20 pontos do segundo (senão é empate e
 * não sugere nada).
 */
export function pickSuggestion(signals: Signal[], clients: Map<string, ClientRef>): ClientSuggestion | null {
  const by = new Map<string, Set<SuggestionReason>>();
  for (const s of signals) {
    if (!clients.has(s.clientId)) continue;
    const set = by.get(s.clientId) ?? new Set<SuggestionReason>();
    set.add(s.reason);
    by.set(s.clientId, set);
  }
  const ranked = [...by.entries()]
    .map(([clientId, reasons]) => {
      const rs = [...reasons].sort((a, b) => REASON_SCORE[b] - REASON_SCORE[a]);
      // Nome parcial só conta se não houver nome completo do mesmo cliente.
      const eff = rs.includes("NOME") ? rs.filter((r) => r !== "NOME_PARCIAL") : rs;
      const score = eff.reduce((acc, r, i) => acc + (i === 0 ? REASON_SCORE[r] : REASON_SCORE[r] / 4), 0);
      return { clientId, reasons: eff, score };
    })
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return null;
  const [top, second] = ranked;
  if (second && top.score - second.score < 20) return null;
  const c = clients.get(top.clientId)!;
  return { clientId: top.clientId, clientName: c.tradeName || c.name, reasons: top.reasons, score: top.score };
}

/** Sinais de nome contra a carteira toda. */
export function nameSignals(convName: string | null | undefined, clients: ClientRef[], agencyStop: Set<string>): Signal[] {
  if (!convName) return [];
  const out: Signal[] = [];
  for (const c of clients) {
    const m = nameMatch(convName, c, agencyStop);
    if (m) out.push({ clientId: c.id, reason: m });
  }
  return out;
}

export function agencyStopwords(agency: { name: string; tradeName?: string | null }): Set<string> {
  return new Set([...significantTokens(agency.name), ...significantTokens(agency.tradeName)]);
}

// ─── Parte com banco ─────────────────────────────────────────────────────────

export interface ConvForSuggestion {
  id: string;
  phone: string;
  isGroup: boolean;
  /** Nome conhecido do grupo/contato (cache de nome, lead). */
  name: string | null;
}

/** Variações do identificador: grupo é o JID exato; número tem 55/9º dígito. */
export function phoneKeys(phone: string): string[] {
  if (phone.includes("@")) return [phone];
  return [...new Set([phone, ...phoneMatchVariants([phone])])];
}

export interface AgencyContext {
  agency: { id: string; name: string; tradeName: string | null };
  clients: ClientRef[];
  clientMap: Map<string, ClientRef>;
  stop: Set<string>;
}

export async function loadAgencyContext(agencyId: string): Promise<AgencyContext | null> {
  const agency = await prisma.company.findUnique({ where: { id: agencyId }, select: { id: true, name: true, tradeName: true } });
  if (!agency) return null;
  const clients = await prisma.company.findMany({
    where: { parentCompanyId: agencyId },
    select: { id: true, name: true, tradeName: true },
  });
  return { agency, clients, clientMap: new Map(clients.map((c) => [c.id, c])), stop: agencyStopwords(agency) };
}

/**
 * Sugestões para várias conversas da mesma agência em poucas queries.
 * Conversa que já tem cliente (contato numa sub-empresa com o MESMO
 * identificador) volta em `linked`, sem sugestão.
 */
export async function suggestClientsForConversations(
  ctx: AgencyContext,
  convs: ConvForSuggestion[],
): Promise<Map<string, { linked: ClientRef | null; suggestion: ClientSuggestion | null }>> {
  const out = new Map<string, { linked: ClientRef | null; suggestion: ClientSuggestion | null }>();
  if (convs.length === 0) return out;
  const clientIds = ctx.clients.map((c) => c.id);
  const keysByConv = new Map(convs.map((c) => [c.id, phoneKeys(c.phone)]));
  const allKeys = [...new Set([...keysByConv.values()].flat())];

  const [contacts, clientPhones, tickets, leads] = await Promise.all([
    prisma.companyContact.findMany({
      where: { phone: { in: allKeys }, companyId: { in: clientIds } },
      select: { phone: true, companyId: true },
    }),
    prisma.company.findMany({
      where: { id: { in: clientIds }, phone: { not: null } },
      select: { id: true, phone: true },
    }),
    prisma.ticket.findMany({
      where: { companyId: ctx.agency.id, phone: { in: allKeys }, clientCompanyId: { in: clientIds } },
      select: { phone: true, clientCompanyId: true },
    }),
    prisma.lead.findMany({
      where: {
        companyId: ctx.agency.id,
        OR: [{ conversationId: { in: convs.map((c) => c.id) } }, { phone: { in: allKeys } }],
        sale: { is: { clientCompanyId: { in: clientIds } } },
      },
      select: { phone: true, conversationId: true, sale: { select: { clientCompanyId: true } } },
    }),
  ]);

  // Telefone do cadastro do cliente, normalizado pelas mesmas variações.
  const clientByPhone = new Map<string, Set<string>>();
  for (const c of clientPhones) {
    for (const k of phoneKeys(String(c.phone).replace(/\D/g, ""))) {
      if (!k) continue;
      const s = clientByPhone.get(k) ?? new Set<string>();
      s.add(c.id);
      clientByPhone.set(k, s);
    }
  }

  for (const conv of convs) {
    const keys = new Set(keysByConv.get(conv.id) ?? []);
    const exact = contacts.find((c) => c.phone === conv.phone);
    if (exact) {
      out.set(conv.id, { linked: ctx.clientMap.get(exact.companyId) ?? null, suggestion: null });
      continue;
    }
    const signals: Signal[] = [];
    for (const c of contacts) if (keys.has(c.phone)) signals.push({ clientId: c.companyId, reason: "CONTATO" });
    if (!conv.isGroup) {
      for (const k of keys) for (const id of clientByPhone.get(k) ?? []) signals.push({ clientId: id, reason: "TELEFONE_CLIENTE" });
    }
    for (const t of tickets) if (t.phone && keys.has(t.phone) && t.clientCompanyId) signals.push({ clientId: t.clientCompanyId, reason: "CHAMADO" });
    for (const l of leads) {
      if ((l.conversationId === conv.id || (l.phone && keys.has(l.phone))) && l.sale?.clientCompanyId) {
        signals.push({ clientId: l.sale.clientCompanyId, reason: "VENDA" });
      }
    }
    signals.push(...nameSignals(conv.name, ctx.clients, ctx.stop));
    out.set(conv.id, { linked: null, suggestion: pickSuggestion(signals, ctx.clientMap) });
  }
  return out;
}

/** Nome conhecido de cada conversa (cache de contato na agência + lead). */
export async function knownNames(agencyId: string, convs: { id: string; phone: string }[]): Promise<Map<string, string | null>> {
  const phones = convs.map((c) => c.phone);
  const [cache, leads] = await Promise.all([
    prisma.companyContact.findMany({ where: { companyId: agencyId, phone: { in: phones } }, select: { phone: true, name: true } }),
    prisma.lead.findMany({
      where: { companyId: agencyId, OR: [{ conversationId: { in: convs.map((c) => c.id) } }, { phone: { in: phones } }] },
      select: { phone: true, conversationId: true, name: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const out = new Map<string, string | null>();
  for (const c of convs) {
    const n =
      cache.find((x) => x.phone === c.phone)?.name ??
      leads.find((l) => l.conversationId === c.id || l.phone === c.phone)?.name ??
      null;
    out.set(c.id, n);
  }
  return out;
}

export class LinkError extends Error {}

/**
 * Liga a conversa ao cliente: cadastra o número/grupo como contato do
 * cliente (as próximas mensagens já caem certo) e tira o mesmo identificador
 * de outros clientes da MESMA agência (troca de cliente). O cache de nome na
 * própria agência fica — o webhook recria de qualquer jeito.
 */
export async function linkConversationToClient(
  agencyId: string,
  conv: { phone: string; isGroup: boolean },
  clientId: string,
  opts: { name?: string | null; role?: string | null } = {},
) {
  const client = await prisma.company.findFirst({ where: { id: clientId, parentCompanyId: agencyId }, select: { id: true, name: true, tradeName: true } });
  if (!client) throw new LinkError("Cliente não pertence a esta empresa");

  const cacheName = opts.name?.trim()
    || (await prisma.companyContact.findUnique({ where: { companyId_phone: { companyId: agencyId, phone: conv.phone } }, select: { name: true } }))?.name
    || null;

  return prisma.$transaction(async (tx) => {
    await tx.companyContact.deleteMany({
      where: {
        phone: conv.phone,
        companyId: { not: client.id },
        company: { parentCompanyId: agencyId },
        // Contato com login no portal não some sozinho.
        userId: null,
      },
    });
    const contact = await tx.companyContact.upsert({
      where: { companyId_phone: { companyId: client.id, phone: conv.phone } },
      create: {
        companyId: client.id,
        phone: conv.phone,
        isGroup: conv.isGroup,
        name: cacheName,
        role: opts.role ?? "CONTACT",
      },
      update: {
        isGroup: conv.isGroup,
        ...(opts.name?.trim() ? { name: opts.name.trim() } : {}),
        ...(opts.role ? { role: opts.role } : {}),
      },
      select: { id: true, name: true, role: true, hasAccess: true },
    });
    return { ...contact, company: { id: client.id, name: client.tradeName || client.name } };
  });
}

/** Desfaz: tira o número/grupo de todos os clientes da agência (fica indefinido). */
export async function unlinkConversationFromClients(agencyId: string, phone: string) {
  return prisma.companyContact.deleteMany({
    where: { phone, company: { parentCompanyId: agencyId }, userId: null },
  });
}

// ─── Correção em lote ────────────────────────────────────────────────────────

export interface FixPlanRow {
  /** Sugestão só pelo nome parcial — conferir na simulação antes de gravar. */
  weak?: boolean;
  conversationId: string;
  phone: string;
  isGroup: boolean;
  name: string | null;
  lastMessageAt: string | null;
  action: "LIGAR" | "INDEFINIDO";
  clientId?: string;
  clientName?: string;
  reasons?: string[];
}

/**
 * Plano da correção: toda conversa da agência sem cliente vira "LIGAR" (com
 * sugestão clara) ou "INDEFINIDO". Conversa já ligada a cliente fica de fora.
 */
export async function planConversationClientFix(agencyId: string): Promise<{ agency: string; rows: FixPlanRow[]; alreadyLinked: number }> {
  const ctx = await loadAgencyContext(agencyId);
  if (!ctx) throw new Error("Agência não encontrada");
  const convs = await prisma.conversation.findMany({
    where: { companyId: agencyId, syncBlocked: false },
    select: { id: true, phone: true, isGroup: true, lastMessageAt: true },
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
  });
  const rows: FixPlanRow[] = [];
  let alreadyLinked = 0;
  const CHUNK = 300;
  for (let i = 0; i < convs.length; i += CHUNK) {
    const part = convs.slice(i, i + CHUNK);
    const names = await knownNames(agencyId, part);
    const res = await suggestClientsForConversations(
      ctx,
      part.map((c) => ({ id: c.id, phone: c.phone, isGroup: c.isGroup || c.phone.includes("@g.us"), name: names.get(c.id) ?? null })),
    );
    for (const c of part) {
      const r = res.get(c.id);
      if (r?.linked) { alreadyLinked++; continue; }
      const base = {
        conversationId: c.id, phone: c.phone, isGroup: c.isGroup || c.phone.includes("@g.us"),
        name: names.get(c.id) ?? null, lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      };
      // Nome parcial sozinho entra marcado "conferir": a simulação mostra e
      // quem roda pode pular conversas específicas (skip) antes de gravar.
      const s = r?.suggestion;
      if (s) {
        const weak = s.reasons.length === 1 && s.reasons[0] === "NOME_PARCIAL";
        rows.push({ ...base, action: "LIGAR", weak, clientId: s.clientId, clientName: s.clientName, reasons: s.reasons.map((x) => REASON_LABEL[x]) });
      } else {
        rows.push({ ...base, action: "INDEFINIDO" });
      }
    }
  }
  return { agency: ctx.agency.name, rows, alreadyLinked };
}

export async function applyConversationClientFix(
  agencyId: string,
  rows: FixPlanRow[],
  opts: { skip?: string[]; onlyStrong?: boolean } = {},
) {
  const skip = new Set(opts.skip ?? []);
  let linked = 0;
  for (const r of rows) {
    if (r.action !== "LIGAR" || !r.clientId) continue;
    if (skip.has(r.conversationId) || skip.has(r.phone)) continue;
    if (opts.onlyStrong && r.weak) continue;
    await linkConversationToClient(agencyId, { phone: r.phone, isGroup: r.isGroup }, r.clientId, { name: r.name });
    linked++;
  }
  return { linked };
}

/** Plano em texto legível (simulação). */
export function formatPlan(agency: string, rows: FixPlanRow[], alreadyLinked: number): string {
  const ligar = rows.filter((r) => r.action === "LIGAR");
  const indef = rows.filter((r) => r.action === "INDEFINIDO");
  const label = (r: FixPlanRow) => `${r.isGroup ? "[grupo] " : ""}${r.name ?? "(sem nome)"} — ${r.phone}`;
  const out = [
    `== ${agency} ==`,
    `${alreadyLinked} conversa(s) já ligadas a cliente (não mexe).`,
    `${ligar.length} vão ser ligadas a um cliente:`,
    ...ligar.map((r) => `  ${r.weak ? "?" : "+"} ${label(r)}  →  ${r.clientName}  (${r.reasons?.join("; ")})${r.weak ? "  ⚠ conferir" : ""}  [${r.conversationId}]`),
    `${indef.length} ficam "cliente indefinido" (nada gravado):`,
    ...indef.map((r) => `  · ${label(r)}`),
    "",
  ];
  return out.join("\n");
}
