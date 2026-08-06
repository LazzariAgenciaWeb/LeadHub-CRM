/**
 * Bling API v3 — helper de OAuth + cliente HTTP.
 *
 * Só a AZZ conecta (1 conexão, guardada em BlingIntegration). Usado pra:
 *   - espelhar cadastro de clientes (contatos), e
 *   - trazer boletos (contas a receber) + NF pro financeiro.
 * A orquestração do sync fica em src/lib/bling-sync.ts; aqui é só OAuth + fetch.
 *
 * Fluxo OAuth (Authorization Code):
 *   1. /api/integrations/bling/connect → redireciona pro Bling (buildBlingAuthorizeUrl)
 *   2. Bling volta em /api/integrations/bling/callback?code=...&state=...
 *      → exchangeCodeForTokens → grava tokens cifrados em BlingIntegration
 *   3. getBlingAccessToken() renova automático quando o access_token expira.
 *
 * Tokens (Bling v3): access_token ~6h (21600s), refresh_token ~30 dias.
 * Cifrados via src/lib/crypto.ts (AES-256-GCM). Nunca retornados ao cliente.
 *
 * ⚠️ Os nomes de campo das respostas da API (contato/contas a receber/NF) seguem
 * a doc do Bling v3, mas devem ser confirmados no 1º sync com token real — o
 * parsing é defensivo (optional chaining + fallbacks) pra não quebrar se um
 * campo vier com nome/estrutura ligeiramente diferente.
 */

import { prisma } from "./prisma";
import { encryptSecret, decryptSecret } from "./crypto";

const CLIENT_ID = process.env.BLING_CLIENT_ID || "";
const CLIENT_SECRET = process.env.BLING_CLIENT_SECRET || "";
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

export const BLING_REDIRECT_URI = `${BASE_URL.replace(/\/$/, "")}/api/integrations/bling/callback`;

const API_BASE = "https://www.bling.com.br/Api/v3";
const AUTH_URL = "https://www.bling.com.br/Api/v3/oauth/authorize";
const TOKEN_URL = "https://www.bling.com.br/Api/v3/oauth/token";

// Margem de segurança: renova se faltar menos de 2 min pra expirar.
const EXPIRY_MARGIN_MS = 2 * 60 * 1000;

/** Garante que as credenciais estão configuradas — usar no início dos handlers. */
export function assertBlingConfigured() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "Bling não configurado. Defina BLING_CLIENT_ID e BLING_CLIENT_SECRET no .env"
    );
  }
}

export function isBlingConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

/** Monta a URL de autorização do Bling. `state` carrega CSRF + contexto. */
export function buildBlingAuthorizeUrl(state: string): string {
  assertBlingConfigured();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface BlingTokenResponse {
  access_token: string;
  expires_in: number; // segundos (~21600)
  token_type: string; // "Bearer"
  scope?: string;
  refresh_token: string;
  error?: string;
  error_description?: string;
}

/** Header Basic base64(client_id:client_secret) — exigido pelo /oauth/token do Bling. */
function basicAuthHeader(): string {
  return "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
}

/** Troca o `code` do callback por tokens. */
export async function exchangeCodeForTokens(code: string): Promise<BlingTokenResponse> {
  assertBlingConfigured();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: BLING_REDIRECT_URI,
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const json = (await r.json().catch(() => ({}))) as BlingTokenResponse;
  if (!r.ok || !json.access_token) {
    throw new Error(
      `Bling: falha ao trocar code por token (${r.status}) ${json.error_description || json.error || ""}`
    );
  }
  return json;
}

/** Renova o access_token usando o refresh_token. */
export async function refreshBlingToken(refreshToken: string): Promise<BlingTokenResponse> {
  assertBlingConfigured();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const json = (await r.json().catch(() => ({}))) as BlingTokenResponse;
  if (!r.ok || !json.access_token) {
    throw new Error(
      `Bling: falha ao renovar token (${r.status}) ${json.error_description || json.error || ""}`
    );
  }
  return json;
}

/** Persiste tokens (cifrados) na BlingIntegration da empresa. */
async function persistTokens(
  companyId: string,
  tokens: BlingTokenResponse,
  createdById?: string | null
) {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const data = {
    accessTokenEnc: encryptSecret(tokens.access_token),
    refreshTokenEnc: encryptSecret(tokens.refresh_token),
    tokenExpiresAt: expiresAt,
    status: "ACTIVE" as const,
    lastError: null,
  };
  await prisma.blingIntegration.upsert({
    where: { companyId },
    update: data,
    create: { companyId, createdById: createdById ?? null, ...data },
  });
}

/** Salva a conexão inicial (chamado no callback). */
export async function saveBlingConnection(
  companyId: string,
  tokens: BlingTokenResponse,
  createdById?: string | null
) {
  await persistTokens(companyId, tokens, createdById);
}

/**
 * Retorna um access_token válido pra empresa, renovando automaticamente se
 * estiver perto de expirar. Lança se não houver conexão ou o refresh falhar
 * (nesse caso marca a integração como EXPIRED pra UI pedir reconexão).
 */
export async function getBlingAccessToken(companyId: string): Promise<string> {
  assertBlingConfigured();
  const integ = await prisma.blingIntegration.findUnique({ where: { companyId } });
  if (!integ || !integ.accessTokenEnc || !integ.refreshTokenEnc) {
    throw new Error("Bling não conectado para esta empresa.");
  }

  const expired =
    !integ.tokenExpiresAt || integ.tokenExpiresAt.getTime() - Date.now() < EXPIRY_MARGIN_MS;

  if (!expired) {
    return decryptSecret(integ.accessTokenEnc);
  }

  // Renova
  try {
    const refreshToken = decryptSecret(integ.refreshTokenEnc);
    const tokens = await refreshBlingToken(refreshToken);
    await persistTokens(companyId, tokens);
    return tokens.access_token;
  } catch (e: any) {
    await prisma.blingIntegration.update({
      where: { companyId },
      data: { status: "EXPIRED", lastError: e?.message?.slice(0, 500) ?? "refresh falhou" },
    });
    throw new Error("Bling: sessão expirada. Reconecte a conta em Configurações → Bling.");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch autenticado na API v3 do Bling. Trata 429 (rate limit ~3 req/s) com
 * um retry curto. Retorna o JSON já parseado.
 */
export async function blingFetch<T = any>(
  companyId: string,
  path: string,
  init?: RequestInit,
  _retry = 0
): Promise<T> {
  const token = await getBlingAccessToken(companyId);
  const r = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (r.status === 429 && _retry < 3) {
    await sleep(1000 * (_retry + 1));
    return blingFetch<T>(companyId, path, init, _retry + 1);
  }

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Bling API ${r.status} em ${path}: ${txt.slice(0, 300)}`);
  }
  return (await r.json().catch(() => ({}))) as T;
}

// ── Tipos parciais das respostas (só o que usamos) ──────────────────────────

export interface BlingContato {
  id: number;
  nome?: string;
  numeroDocumento?: string; // CPF/CNPJ
  tipo?: string; // "F" (física) | "J" (jurídica)
  email?: string;
  telefone?: string;
  celular?: string;
  situacao?: string;
  // Papel do contato (cliente/fornecedor/...). Estrutura pode variar: às vezes
  // vem em `tiposContato: [{ descricao }]`, às vezes num id de tipo. Tratado
  // defensivamente no sync.
  tiposContato?: Array<{ id?: number; descricao?: string }>;
}

export interface BlingContaReceber {
  id: number;
  vencimento?: string; // "YYYY-MM-DD"
  valor?: number;
  situacao?: number | string; // 1=aberto, 2=recebido, 3=parcial, ... (confirmar)
  dataPagamento?: string;
  historico?: string;
  numeroDocumento?: string;
  linkBoleto?: string;
  contato?: { id?: number; nome?: string };
  competencia?: string;
}

export interface BlingNfe {
  id: number;
  numero?: string;
  serie?: string;
  situacao?: number | string;
  dataEmissao?: string;
  valorNota?: number;
  linkDanfe?: string;
  linkPDF?: string;
  contato?: { id?: number; nome?: string; numeroDocumento?: string };
}

/** Só dígitos de um CPF/CNPJ (chave de casamento). */
export function onlyDigits(doc: string | null | undefined): string {
  return (doc ?? "").replace(/\D/g, "");
}

const PAGE_LIMIT = 100;

/**
 * Pagina um endpoint de listagem do Bling (`pagina`/`limite`) até esgotar.
 * Retorna o array concatenado de `data`. Respeita o rate limit com um respiro
 * entre páginas.
 */
async function listAll<T = any>(
  companyId: string,
  path: string,
  extraQuery: Record<string, string> = {},
  maxPages = 200
): Promise<T[]> {
  const out: T[] = [];
  for (let pagina = 1; pagina <= maxPages; pagina++) {
    const qs = new URLSearchParams({
      pagina: String(pagina),
      limite: String(PAGE_LIMIT),
      ...extraQuery,
    });
    const json = await blingFetch<{ data?: T[] }>(companyId, `${path}?${qs.toString()}`);
    const rows = json?.data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_LIMIT) break;
    await sleep(350); // ~3 req/s
  }
  return out;
}

/** Lista todos os contatos (clientes/fornecedores) do Bling. */
export function listContatos(companyId: string): Promise<BlingContato[]> {
  return listAll<BlingContato>(companyId, "/contatos");
}

/** Lista todas as contas a receber (boletos). */
export function listContasReceber(companyId: string): Promise<BlingContaReceber[]> {
  return listAll<BlingContaReceber>(companyId, "/contas/receber");
}

/** Lista as NF-e emitidas. */
export function listNfe(companyId: string): Promise<BlingNfe[]> {
  return listAll<BlingNfe>(companyId, "/nfe");
}

/**
 * Cria um contato no Bling a partir de uma empresa do LeadHub (sync mão dupla:
 * cliente que existe aqui e não no Bling). Retorna o id criado.
 */
export async function createContato(
  companyId: string,
  input: { nome: string; documento?: string; email?: string; telefone?: string }
): Promise<number> {
  const doc = onlyDigits(input.documento);
  const body: Record<string, any> = { nome: input.nome };
  if (doc) {
    body.numeroDocumento = doc;
    body.tipo = doc.length > 11 ? "J" : "F"; // CNPJ=14, CPF=11
  }
  if (input.email) body.email = input.email;
  if (input.telefone) body.telefone = input.telefone;

  const json = await blingFetch<{ data?: { id?: number } }>(companyId, "/contatos", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const id = json?.data?.id;
  if (!id) throw new Error("Bling: contato criado mas sem id na resposta.");
  return id;
}
