/**
 * Liga email ↔ cliente (empresa da carteira da agência).
 *
 * Até aqui o email só sabia de lead e chamado — abrir o cliente não mostrava
 * a conversa com ele. A ligação automática segue, nesta ordem:
 *   1. mesma conversa (In-Reply-To de um email já ligado);
 *   2. chamado ligado ao email que é de um cliente;
 *   3. lead ligado ao email cuja venda virou um cliente;
 *   4. endereço EXATO de um contato do cliente (email do cadastro, usuários
 *      do cliente, email do lead da venda);
 *   5. DOMÍNIO próprio do cliente (do email do cadastro, do site, dos
 *      contatos) — nunca provedor público (gmail, hotmail…) nem o domínio da
 *      própria agência.
 * Só liga quando a resposta é UMA: endereço/domínio de dois clientes não liga
 * nada (melhor sem vínculo que vínculo errado). Manual sempre ganha — o email
 * desligado à mão (clientLinkSource = NONE) não é religado.
 */

import { prisma } from "./prisma";

const FREE_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.com.br", "outlook.com", "outlook.com.br",
  "live.com", "msn.com", "yahoo.com", "yahoo.com.br", "ymail.com", "icloud.com", "me.com", "mac.com",
  "uol.com.br", "bol.com.br", "terra.com.br", "ig.com.br", "globo.com", "globomail.com", "r7.com",
  "zipmail.com.br", "aol.com", "protonmail.com", "proton.me", "gmx.com", "zoho.com", "yandex.com",
]);

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Endereços contidos num campo To/Cc ("Nome <a@b.com>, c@d.com"). */
export function extractAddresses(...fields: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const f of fields) for (const m of (f ?? "").match(EMAIL_RE) ?? []) out.add(m.toLowerCase());
  return [...out];
}

function domainOf(email: string): string | null {
  const d = email.split("@")[1]?.trim().toLowerCase();
  return d || null;
}

function domainOfUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

interface ClientIndex {
  exact: Map<string, Set<string>>;
  domain: Map<string, Set<string>>;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; index: ClientIndex }>();

/** Esquece o índice (cadastro/contato do cliente mudou). */
export function invalidateClientEmailIndex(agencyId: string) {
  cache.delete(agencyId);
}

function add(map: Map<string, Set<string>>, key: string | null, clientId: string) {
  if (!key) return;
  let s = map.get(key);
  if (!s) map.set(key, (s = new Set()));
  s.add(clientId);
}

async function buildIndex(agencyId: string): Promise<ClientIndex> {
  const [agency, accounts, clients, sales] = await Promise.all([
    prisma.company.findUnique({ where: { id: agencyId }, select: { email: true, website: true } }),
    prisma.emailAccount.findMany({ where: { companyId: agencyId }, select: { fromEmail: true } }),
    prisma.company.findMany({
      where: { parentCompanyId: agencyId },
      select: {
        id: true, email: true, website: true,
        users: { select: { email: true } },
        contacts: { select: { user: { select: { email: true } } } },
      },
    }),
    prisma.sale.findMany({
      where: { companyId: agencyId, clientCompanyId: { not: null }, lead: { email: { not: null } } },
      select: { clientCompanyId: true, lead: { select: { email: true } } },
    }),
  ]);

  // Domínios que NUNCA identificam cliente: provedores públicos e a própria agência.
  const ownDomains = new Set<string>(
    [agency?.email ? domainOf(agency.email) : null, domainOfUrl(agency?.website), ...accounts.map((a) => domainOf(a.fromEmail))]
      .filter((d): d is string => !!d),
  );
  const domainOk = (d: string | null) => !!d && !FREE_DOMAINS.has(d) && !ownDomains.has(d);

  const index: ClientIndex = { exact: new Map(), domain: new Map() };
  const addEmail = (raw: string | null | undefined, clientId: string) => {
    const e = raw?.trim().toLowerCase();
    if (!e || !e.includes("@")) return;
    add(index.exact, e, clientId);
    const d = domainOf(e);
    if (domainOk(d)) add(index.domain, d, clientId);
  };

  for (const c of clients) {
    addEmail(c.email, c.id);
    for (const u of c.users) addEmail(u.email, c.id);
    for (const k of c.contacts) addEmail(k.user?.email, c.id);
    const site = domainOfUrl(c.website);
    if (domainOk(site)) add(index.domain, site, c.id);
  }
  for (const s of sales) addEmail(s.lead?.email, s.clientCompanyId!);

  return index;
}

async function getIndex(agencyId: string): Promise<ClientIndex> {
  const hit = cache.get(agencyId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.index;
  const index = await buildIndex(agencyId);
  cache.set(agencyId, { at: Date.now(), index });
  return index;
}

function single(sets: (Set<string> | undefined)[]): string | null {
  const all = new Set<string>();
  for (const s of sets) if (s) for (const id of s) all.add(id);
  return all.size === 1 ? [...all][0] : null;
}

/** Cliente de uma lista de endereços — só quando a resposta é única. */
export async function clientForAddresses(agencyId: string, addresses: string[]): Promise<string | null> {
  const list = addresses.map((a) => a.toLowerCase()).filter((a) => a.includes("@"));
  if (list.length === 0) return null;
  const index = await getIndex(agencyId);
  const byExact = single(list.map((a) => index.exact.get(a)));
  if (byExact) return byExact;
  // Endereço exato ambíguo não cai pro domínio: se o mesmo email é de dois
  // clientes, o domínio não vai resolver melhor.
  if (list.some((a) => index.exact.has(a))) return null;
  return single(list.map((a) => index.domain.get(domainOf(a) ?? "")));
}

/**
 * Cliente de um email novo (recebido ou enviado). Usa a conversa e os vínculos
 * já resolvidos (lead/chamado) antes dos endereços.
 */
export async function resolveClientForEmail(
  agencyId: string,
  hint: { inReplyTo?: string | null; replyToId?: string | null; leadId?: string | null; ticketId?: string | null; addresses: string[] },
): Promise<string | null> {
  try {
    if (hint.inReplyTo || hint.replyToId) {
      const original = await prisma.inboxEmail.findFirst({
        where: hint.replyToId
          ? { id: hint.replyToId, companyId: agencyId }
          : { companyId: agencyId, messageId: hint.inReplyTo! },
        select: { clientCompanyId: true },
      });
      if (original?.clientCompanyId) return original.clientCompanyId;
    }
    if (hint.ticketId) {
      const t = await prisma.ticket.findFirst({
        where: { id: hint.ticketId, companyId: agencyId },
        select: { clientCompanyId: true },
      });
      if (t?.clientCompanyId) return t.clientCompanyId;
    }
    if (hint.leadId) {
      const s = await prisma.sale.findFirst({
        where: { leadId: hint.leadId, companyId: agencyId, clientCompanyId: { not: null } },
        select: { clientCompanyId: true },
      });
      if (s?.clientCompanyId) return s.clientCompanyId;
    }
    return await clientForAddresses(agencyId, hint.addresses);
  } catch (e) {
    // Vínculo é conveniência: nunca derruba a gravação do email.
    console.warn("[client-email-link]", e);
    return null;
  }
}

/**
 * Ligação MANUAL (ou desligamento) de um email a um cliente da carteira.
 * clientId null = desliga e marca NONE, pra automática não religar.
 */
export async function setEmailClient(agencyId: string, emailId: string, clientId: string | null) {
  const email = await prisma.inboxEmail.findFirst({ where: { id: emailId, companyId: agencyId }, select: { id: true } });
  if (!email) throw new Error("E-mail não encontrado nesta empresa.");
  if (clientId) {
    const c = await prisma.company.findFirst({ where: { id: clientId, parentCompanyId: agencyId }, select: { id: true } });
    if (!c) throw new Error("Cliente não pertence a esta carteira.");
  }
  return prisma.inboxEmail.update({
    where: { id: emailId },
    data: clientId
      ? { clientCompanyId: clientId, clientLinkSource: "MANUAL" }
      : { clientCompanyId: null, clientLinkSource: "NONE", clientMark: null },
    select: { id: true, clientCompanyId: true, clientLinkSource: true, clientMark: true },
  });
}

/**
 * Liga ao cliente os emails ANTIGOS da caixa (anteriores à ligação automática
 * ou ao cadastro do contato). Só mexe em email sem vínculo e nunca desligado
 * à mão. Devolve quantos ligou.
 */
export async function linkPastEmailsForClient(agencyId: string, clientId: string): Promise<number> {
  invalidateClientEmailIndex(agencyId);
  const index = await getIndex(agencyId);

  const exacts = [...index.exact.entries()].filter(([, s]) => s.has(clientId)).map(([e]) => e);
  const domains = [...index.domain.entries()].filter(([, s]) => s.size === 1 && s.has(clientId)).map(([d]) => d);
  if (exacts.length === 0 && domains.length === 0) return 0;

  const or: any[] = [];
  for (const e of exacts) {
    or.push({ fromEmail: { equals: e, mode: "insensitive" } });
    or.push({ toEmail: { contains: e, mode: "insensitive" } });
    or.push({ ccEmail: { contains: e, mode: "insensitive" } });
  }
  for (const d of domains) {
    or.push({ fromEmail: { endsWith: `@${d}`, mode: "insensitive" } });
    or.push({ toEmail: { contains: `@${d}`, mode: "insensitive" } });
    or.push({ ccEmail: { contains: `@${d}`, mode: "insensitive" } });
  }

  const candidates = await prisma.inboxEmail.findMany({
    where: { companyId: agencyId, clientCompanyId: null, clientLinkSource: null, OR: or },
    select: { id: true, direction: true, fromEmail: true, toEmail: true, ccEmail: true },
    take: 3000,
  });

  const ids: string[] = [];
  for (const e of candidates) {
    // Recebido: quem manda é o cliente. Enviado: os destinatários são.
    const addrs = e.direction === "IN" ? [e.fromEmail] : extractAddresses(e.toEmail, e.ccEmail);
    if ((await clientForAddresses(agencyId, addrs)) === clientId) ids.push(e.id);
  }
  if (ids.length === 0) return 0;
  const r = await prisma.inboxEmail.updateMany({
    where: { id: { in: ids }, clientCompanyId: null },
    data: { clientCompanyId: clientId, clientLinkSource: "AUTO" },
  });
  return r.count;
}
