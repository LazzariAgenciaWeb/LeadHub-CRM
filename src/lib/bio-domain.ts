/**
 * Domínio próprio da Página do Negócio.
 *
 * O cliente do plano com site próprio informa o domínio dele no editor; a
 * página passa a abrir na raiz desse domínio, com HTTPS. Quem emite e renova o
 * certificado é a **Cloudflare for SaaS** na zona do GoHub: criamos um "custom
 * hostname" lá, o cliente aponta o DNS, a Cloudflare valida a posse e emite.
 *
 * Sem as variáveis da Cloudflare o fluxo não morre: o domínio fica gravado, o
 * editor mostra os registros e a verificação olha o DNS de verdade — só a
 * liberação final do HTTPS fica para o super admin (ativação manual).
 *
 * Variáveis:
 *  - CLOUDFLARE_API_TOKEN      token com "SSL and Certificates: Edit" + "Zone: Read"
 *  - CLOUDFLARE_SAAS_ZONE_ID   id da zona que hospeda os custom hostnames (gohub.com.br)
 *  - BIO_DOMAIN_TARGET         alvo do CNAME do cliente (ex.: sites.gohub.com.br)
 */

import { promises as dns } from "node:dns";
import type { BioDomainStatus } from "@/lib/bio-page";

const CF_API = "https://api.cloudflare.com/client/v4";

function token(): string | null {
  return process.env.CLOUDFLARE_API_TOKEN?.trim() || null;
}

function zoneId(): string | null {
  return process.env.CLOUDFLARE_SAAS_ZONE_ID?.trim() || null;
}

/** Alvo do CNAME que o cliente cria. Sem a variável, deduz do endereço público. */
export function bioDomainTarget(): string {
  const fromEnv = process.env.BIO_DOMAIN_TARGET?.trim();
  if (fromEnv) return fromEnv.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const base = process.env.BIO_PUBLIC_BASE_URL?.trim();
  if (base) {
    try {
      return `sites.${new URL(base).hostname.replace(/^www\./, "")}`;
    } catch {
      /* cai no padrão */
    }
  }
  return "sites.gohub.com.br";
}

/** A emissão automática do HTTPS está configurada? */
export function cloudflareReady(): boolean {
  return !!token() && !!zoneId();
}

// ─── Chamada à API ───────────────────────────────────────────────────────────

type CfResponse<T> = {
  success: boolean;
  result?: T;
  errors?: { code?: number; message?: string }[];
};

export class CloudflareError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
  }
}

async function cf<T>(path: string, init?: RequestInit): Promise<T> {
  const t = token();
  const z = zoneId();
  if (!t || !z) throw new CloudflareError("Cloudflare não configurada");
  const res = await fetch(`${CF_API}/zones/${z}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    // A Cloudflare responde rápido; não deixar um request pendurado prender o editor.
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as CfResponse<T> | null;
  if (!res.ok || !body?.success) {
    const first = body?.errors?.[0];
    throw new CloudflareError(first?.message || `Cloudflare respondeu HTTP ${res.status}`, first?.code);
  }
  return body.result as T;
}

// ─── Custom hostname ─────────────────────────────────────────────────────────

type CfCustomHostname = {
  id: string;
  hostname: string;
  status?: string;
  verification_errors?: string[];
  ownership_verification?: { type?: string; name?: string; value?: string };
  ownership_verification_http?: { http_url?: string; http_body?: string };
  ssl?: {
    status?: string;
    validation_errors?: { message?: string }[];
    txt_name?: string;
    txt_value?: string;
  };
};

/** O que o resto do sistema precisa saber de um custom hostname. */
export interface BioDomainRemote {
  cfHostnameId: string;
  status: BioDomainStatus;
  statusMessage: string | null;
  /** Registro TXT de posse que o cliente precisa criar (quando exigido). */
  verifyName: string | null;
  verifyValue: string | null;
}

/**
 * Hostname "active" + certificado "active" = no ar. Tempo esgotado, bloqueio ou
 * erro de validação = problema. O resto é caminho: PENDING enquanto a posse não
 * foi provada, VERIFYING quando falta só o certificado.
 */
function readRemote(h: CfCustomHostname): BioDomainRemote {
  const status = (h.status ?? "").toLowerCase();
  const ssl = (h.ssl?.status ?? "").toLowerCase();
  const errors = [
    ...(h.verification_errors ?? []),
    ...(h.ssl?.validation_errors ?? []).map((e) => e.message ?? "").filter(Boolean),
  ];

  const own = h.ownership_verification;
  const verifyName = own?.name?.trim() || h.ssl?.txt_name?.trim() || null;
  const verifyValue = own?.value?.trim() || h.ssl?.txt_value?.trim() || null;

  const base: Omit<BioDomainRemote, "status" | "statusMessage"> = {
    cfHostnameId: h.id,
    verifyName,
    verifyValue,
  };

  if (status === "active" && (ssl === "active" || ssl === "")) {
    return { ...base, status: "ACTIVE", statusMessage: null };
  }
  const travou = status.includes("blocked") || status === "moved" || ssl.endsWith("timed_out") || ssl === "expired";
  if (travou) {
    return {
      ...base,
      status: "ERROR",
      statusMessage:
        errors[0] ??
        "A Cloudflare não conseguiu validar o domínio. Confira os registros no seu provedor de DNS e tente de novo.",
    };
  }
  if (status === "active") {
    return { ...base, status: "VERIFYING", statusMessage: "Domínio apontado. Estamos emitindo o certificado de segurança." };
  }
  return {
    ...base,
    status: "PENDING",
    statusMessage: errors[0] ?? null,
  };
}

/** Cria (ou reusa) o custom hostname na Cloudflare. */
export async function createRemoteDomain(hostname: string): Promise<BioDomainRemote> {
  try {
    const created = await cf<CfCustomHostname>("/custom_hostnames", {
      method: "POST",
      body: JSON.stringify({
        hostname,
        ssl: {
          method: "txt",
          type: "dv",
          settings: { min_tls_version: "1.2" },
          // Sem isto, a Cloudflare só valida por TXT; com isto ela também
          // aceita a própria presença do CNAME como prova de posse.
          wildcard: false,
        },
      }),
    });
    return readRemote(created);
  } catch (e) {
    // 1406 = hostname já existe nesta zona (recriação depois de um erro).
    if (e instanceof CloudflareError && e.code === 1406) {
      const found = await findRemoteDomain(hostname);
      if (found) return found;
    }
    throw e;
  }
}

/** Busca o custom hostname pelo nome (usado quando o id foi perdido). */
export async function findRemoteDomain(hostname: string): Promise<BioDomainRemote | null> {
  const list = await cf<CfCustomHostname[]>(`/custom_hostnames?hostname=${encodeURIComponent(hostname)}`);
  const found = list.find((h) => h.hostname?.toLowerCase() === hostname);
  return found ? readRemote(found) : null;
}

/** Situação atual de um custom hostname já criado. */
export async function readRemoteDomain(cfHostnameId: string): Promise<BioDomainRemote> {
  return readRemote(await cf<CfCustomHostname>(`/custom_hostnames/${cfHostnameId}`));
}

/**
 * Apaga o custom hostname. Domínio pendente também conta na cota da Cloudflare,
 * então o que o cliente desiste de usar sai de lá.
 */
export async function deleteRemoteDomain(cfHostnameId: string): Promise<void> {
  try {
    await cf(`/custom_hostnames/${cfHostnameId}`, { method: "DELETE" });
  } catch (e) {
    // Já não existe lá: o objetivo (não ocupar cota) está cumprido.
    if (e instanceof CloudflareError && (e.code === 1436 || e.code === 1437)) return;
    throw e;
  }
}

// ─── Conferência do DNS ──────────────────────────────────────────────────────

export interface BioDnsCheck {
  /** O host aponta pro lugar certo? */
  ok: boolean;
  /** O que achamos no DNS, pra explicar o que está errado. */
  found: string[];
  message: string | null;
}

/**
 * Olha o DNS de fora, como o visitante veria. Serve pra dizer ao dono da página
 * se ele já criou o registro — e é a única verificação possível enquanto a
 * Cloudflare não está configurada.
 */
export async function checkDomainDns(hostname: string): Promise<BioDnsCheck> {
  const target = bioDomainTarget().toLowerCase();
  const found: string[] = [];

  const cname = await dns.resolveCname(hostname).catch(() => [] as string[]);
  for (const c of cname) found.push(c.toLowerCase().replace(/\.$/, ""));
  if (found.some((c) => c === target || c.endsWith(`.${target}`))) {
    return { ok: true, found, message: null };
  }

  // Raiz do domínio não aceita CNAME: aí o apontamento é por A, e quem responde
  // é a Cloudflare. Comparamos com os endereços do nosso próprio alvo.
  const [ips, alvoIps] = await Promise.all([
    dns.resolve4(hostname).catch(() => [] as string[]),
    dns.resolve4(target).catch(() => [] as string[]),
  ]);
  for (const ip of ips) found.push(ip);
  if (ips.length > 0 && alvoIps.length > 0 && ips.some((ip) => alvoIps.includes(ip))) {
    return { ok: true, found, message: null };
  }

  if (found.length === 0) {
    return {
      ok: false,
      found,
      message: `Ainda não encontramos nenhum registro para ${hostname}. Depois de criar, o DNS pode levar alguns minutos para aparecer.`,
    };
  }
  return {
    ok: false,
    found,
    message: `O domínio está apontando para outro lugar (${found.slice(0, 2).join(", ")}). Troque o registro para ${target}.`,
  };
}
