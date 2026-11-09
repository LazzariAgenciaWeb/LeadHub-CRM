/**
 * Domínio próprio da Página do Negócio — lado servidor.
 *
 * Quem pode ativar, cadastro do domínio, verificação do apontamento e a busca
 * da página pelo host (é isso que faz o domínio do cliente abrir a página).
 * A conversa com a Cloudflare fica em `bio-domain.ts`.
 */

import { prisma } from "@/lib/prisma";
import { getCompanyPlan } from "@/lib/limits";
import {
  BIO_DOMAIN_PROBLEM_LABEL,
  bioDomainIsRoot,
  bioDomainProblem,
  bioDomainSuggestion,
  normalizeBioDomain,
  type BioDomainProblem,
  type BioDomainStatus,
} from "@/lib/bio-page";
import {
  CloudflareError,
  bioDomainTarget,
  checkDomainDns,
  cloudflareReady,
  createRemoteDomain,
  deleteRemoteDomain,
  findRemoteDomain,
  readRemoteDomain,
} from "@/lib/bio-domain";

/** Dados do domínio como o editor e o painel mostram. */
export interface BioDomainView {
  hostname: string;
  status: BioDomainStatus;
  statusMessage: string | null;
  /** Registro de apontamento do site (sempre presente). */
  cname: { name: string; value: string };
  /** Registro TXT de posse, quando a Cloudflare pede. */
  txt: { name: string; value: string } | null;
  /** O host é a raiz do domínio — raiz não aceita CNAME na maioria dos provedores. */
  root: boolean;
  /** Emissão automática do HTTPS configurada no servidor. */
  automatic: boolean;
  manual: boolean;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  /** Endereço final do site, quando já está no ar. */
  url: string | null;
}

type DomainRow = {
  id: string;
  hostname: string;
  status: BioDomainStatus;
  statusMessage: string | null;
  cfHostnameId: string | null;
  verifyName: string | null;
  verifyValue: string | null;
  cnameTarget: string | null;
  manual: boolean;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
};

const DOMAIN_SELECT = {
  id: true,
  hostname: true,
  status: true,
  statusMessage: true,
  cfHostnameId: true,
  verifyName: true,
  verifyValue: true,
  cnameTarget: true,
  manual: true,
  verifiedAt: true,
  lastCheckedAt: true,
} as const;

export function toDomainView(row: DomainRow): BioDomainView {
  // O host do cliente é sempre o nome do registro; "www.loja.com.br" vira o
  // nome "www" no painel do provedor, mas mostrar o host completo evita erro.
  return {
    hostname: row.hostname,
    status: row.status,
    statusMessage: row.statusMessage,
    cname: { name: row.hostname, value: row.cnameTarget ?? bioDomainTarget() },
    txt: row.verifyName && row.verifyValue ? { name: row.verifyName, value: row.verifyValue } : null,
    root: bioDomainIsRoot(row.hostname),
    automatic: cloudflareReady(),
    manual: row.manual,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    url: row.status === "ACTIVE" ? `https://${row.hostname}` : null,
  };
}

// ─── Permissão ───────────────────────────────────────────────────────────────

/**
 * O plano da empresa inclui site próprio?
 *
 * Vai pelo `getCompanyPlan` porque ele resolve o que a assinatura sozinha não
 * resolve: empresa-filha SEM assinatura própria herda o plano da matriz (é o
 * caso dos clientes da agência). Olhando só a Subscription da empresa, um
 * cliente no Premium pela matriz aparecia como se estivesse no Grátis.
 *
 * `paginaSiteProprio` está fora do teto da empresa-mãe (ver CEILING_EXEMPT em
 * limits.ts): a página é linha de produto à parte, vendida direto ao cliente.
 */
export async function companyHasOwnSite(companyId: string): Promise<boolean> {
  const ctx = await getCompanyPlan(companyId).catch(() => null);
  return ctx?.effectiveFeatures.paginaSiteProprio === true;
}

export class DomainPlanError extends Error {
  constructor() {
    super("O site próprio no seu domínio entra a partir do plano Essencial.");
  }
}

export class DomainInputError extends Error {
  constructor(readonly problem: BioDomainProblem, readonly suggestion: string | null = null) {
    super(BIO_DOMAIN_PROBLEM_LABEL[problem]);
  }
}

// ─── Leitura ─────────────────────────────────────────────────────────────────

export async function loadBioDomain(pageId: string): Promise<BioDomainView | null> {
  const row = await prisma.bioDomain.findUnique({ where: { pageId }, select: DOMAIN_SELECT });
  return row ? toDomainView(row) : null;
}

/**
 * Página servida num domínio de cliente. Só domínio ATIVO e página publicada —
 * é o que o proxy e a rota do site usam para responder uma requisição.
 */
export async function pageSlugByHost(host: string): Promise<string | null> {
  const hostname = normalizeBioDomain(host);
  if (!hostname || bioDomainProblem(hostname)) return null;
  const found = await prisma.bioDomain.findUnique({
    where: { hostname },
    select: { status: true, page: { select: { slug: true, published: true } } },
  });
  if (!found || found.status !== "ACTIVE" || !found.page.published) return null;
  return found.page.slug;
}

// ─── Cadastro ────────────────────────────────────────────────────────────────

/**
 * Grava o domínio da página e cria o custom hostname na Cloudflare. Trocar de
 * domínio apaga o anterior lá (domínio pendente também ocupa cota).
 */
export async function setBioDomain(
  pageId: string,
  companyId: string,
  raw: string,
  opts: { asAdmin?: boolean } = {},
): Promise<BioDomainView> {
  // O super admin cadastra domínio para o cliente mesmo antes de o plano mudar
  // (contratou por fora, está em teste): a regra de plano é do autoatendimento.
  if (!opts.asAdmin && !(await companyHasOwnSite(companyId))) throw new DomainPlanError();

  const hostname = normalizeBioDomain(raw);
  const problem = bioDomainProblem(hostname);
  if (problem) throw new DomainInputError(problem, bioDomainSuggestion(hostname));

  const taken = await prisma.bioDomain.findUnique({ where: { hostname }, select: { pageId: true } });
  if (taken && taken.pageId !== pageId) throw new DomainInputError("em-uso");

  const atual = await prisma.bioDomain.findUnique({ where: { pageId }, select: DOMAIN_SELECT });
  if (atual && atual.hostname === hostname) return refreshBioDomain(pageId);

  // Domínio antigo sai da Cloudflare antes de entrar o novo.
  if (atual?.cfHostnameId) await deleteRemoteDomain(atual.cfHostnameId).catch(() => {});

  let remote: Awaited<ReturnType<typeof createRemoteDomain>> | null = null;
  let erro: string | null = null;
  if (cloudflareReady()) {
    try {
      remote = await createRemoteDomain(hostname);
    } catch (e) {
      // A Cloudflare pode recusar (cota, domínio em outra conta). O domínio
      // fica gravado com a mensagem para o dono não ficar sem resposta.
      erro = e instanceof CloudflareError ? e.message : "Não conseguimos preparar o certificado agora. Tente de novo em alguns minutos.";
      console.error("[pagina/dominio] Cloudflare recusou", hostname, e);
    }
  }

  const data = {
    hostname,
    status: remote?.status ?? ("PENDING" as BioDomainStatus),
    statusMessage: remote?.statusMessage ?? erro,
    cfHostnameId: remote?.cfHostnameId ?? null,
    verifyName: remote?.verifyName ?? null,
    verifyValue: remote?.verifyValue ?? null,
    cnameTarget: bioDomainTarget(),
    manual: false,
    verifiedAt: remote?.status === "ACTIVE" ? new Date() : null,
    lastCheckedAt: new Date(),
  };

  const row = await prisma.bioDomain.upsert({
    where: { pageId },
    create: { pageId, ...data },
    update: data,
    select: DOMAIN_SELECT,
  });
  return toDomainView(row);
}

/**
 * Reconfere o domínio: pergunta à Cloudflare como está o custom hostname e,
 * quando ela ainda não confirmou (ou não está configurada), olha o DNS para
 * dizer ao dono se o registro já existe.
 */
export async function refreshBioDomain(pageId: string): Promise<BioDomainView> {
  const row = await prisma.bioDomain.findUnique({ where: { pageId }, select: DOMAIN_SELECT });
  if (!row) throw new Error("Esta página não tem domínio próprio.");
  // Ativado à mão pelo super admin: ninguém mexe no status automaticamente.
  if (row.manual) return toDomainView(row);

  let status: BioDomainStatus = row.status;
  let statusMessage: string | null = row.statusMessage;
  let verifyName = row.verifyName;
  let verifyValue = row.verifyValue;
  let cfHostnameId = row.cfHostnameId;

  if (cloudflareReady()) {
    try {
      const remote = cfHostnameId
        ? await readRemoteDomain(cfHostnameId)
        : (await findRemoteDomain(row.hostname)) ?? (await createRemoteDomain(row.hostname));
      cfHostnameId = remote.cfHostnameId;
      status = remote.status;
      statusMessage = remote.statusMessage;
      verifyName = remote.verifyName ?? verifyName;
      verifyValue = remote.verifyValue ?? verifyValue;
    } catch (e) {
      console.error("[pagina/dominio] falha ao consultar a Cloudflare", row.hostname, e);
      statusMessage = e instanceof CloudflareError ? e.message : statusMessage;
    }
  }

  // A Cloudflare ainda não deu o domínio como ativo: o DNS conta ao dono o que
  // falta. Sem a Cloudflare configurada, é a única verificação que existe.
  if (status !== "ACTIVE") {
    const dnsCheck = await checkDomainDns(row.hostname);
    if (dnsCheck.ok) {
      status = cloudflareReady() ? (status === "PENDING" ? "VERIFYING" : status) : "VERIFYING";
      statusMessage =
        statusMessage ??
        (cloudflareReady()
          ? "Domínio apontado. Estamos emitindo o certificado de segurança."
          : "Domínio apontado. A AZZ conclui a liberação do HTTPS.");
    } else if (status !== "ERROR") {
      status = "PENDING";
      statusMessage = dnsCheck.message;
    }
  }

  const updated = await prisma.bioDomain.update({
    where: { pageId },
    data: {
      status,
      statusMessage: status === "ACTIVE" ? null : statusMessage,
      cfHostnameId,
      verifyName,
      verifyValue,
      cnameTarget: row.cnameTarget ?? bioDomainTarget(),
      lastCheckedAt: new Date(),
      verifiedAt: status === "ACTIVE" ? row.verifiedAt ?? new Date() : row.verifiedAt,
    },
    select: DOMAIN_SELECT,
  });
  return toDomainView(updated);
}

/** Tira o domínio da página (e da Cloudflare, pra não ocupar cota). */
export async function removeBioDomain(pageId: string): Promise<void> {
  const row = await prisma.bioDomain.findUnique({ where: { pageId }, select: { cfHostnameId: true } });
  if (!row) return;
  if (row.cfHostnameId) await deleteRemoteDomain(row.cfHostnameId).catch(() => {});
  await prisma.bioDomain.delete({ where: { pageId } }).catch(() => {});
}

/**
 * Ativação manual do super admin: o domínio já está servido (ou ele conferiu a
 * mão) e deve passar a valer. `manual` impede o cron de reverter.
 */
export async function setBioDomainStatusManually(
  pageId: string,
  status: BioDomainStatus,
  message: string | null,
): Promise<BioDomainView> {
  const row = await prisma.bioDomain.update({
    where: { pageId },
    data: {
      status,
      statusMessage: status === "ACTIVE" ? null : message,
      manual: status === "ACTIVE",
      verifiedAt: status === "ACTIVE" ? new Date() : null,
      lastCheckedAt: new Date(),
    },
    select: DOMAIN_SELECT,
  });
  return toDomainView(row);
}

/**
 * Reconferência em lote (cron): domínios que ainda não estão no ar. Deixa de
 * fora os ativos e os que o super admin travou à mão.
 */
export async function refreshPendingDomains(limit = 25): Promise<{ checked: number; active: number }> {
  const pendentes = await prisma.bioDomain.findMany({
    where: { manual: false, status: { in: ["PENDING", "VERIFYING", "ERROR"] } },
    orderBy: [{ lastCheckedAt: { sort: "asc", nulls: "first" } }],
    take: limit,
    select: { pageId: true },
  });
  let active = 0;
  for (const d of pendentes) {
    const view = await refreshBioDomain(d.pageId).catch((e) => {
      console.error("[pagina/dominio] falha ao reconferir", d.pageId, e);
      return null;
    });
    if (view?.status === "ACTIVE") active++;
  }
  return { checked: pendentes.length, active };
}
