/**
 * Integração cPanel (hospedagem do cliente).
 *
 * O token de API do cPanel (cPanel → Manage API Tokens) dá acesso à conta
 * INTEIRA — arquivos, e-mails, bancos. Por isso este arquivo concentra as travas:
 *
 *  1. Token cifrado em repouso (crypto.ts) e decifrado só aqui, na hora da
 *     chamada. Nunca sai em resposta de API, log ou mensagem de erro.
 *  2. Host validado contra SSRF: só nome/IP público, só portas do cPanel, sem
 *     seguir redirect — senão o cadastro vira um jeito de fazer o servidor do
 *     GoHub bater em endereço interno carregando credencial.
 *  3. `publishDir` confina tudo a uma pasta: resolveCpanelPath recusa "..",
 *     caminho absoluto e pasta oculta (.ssh, .cpanel, .htpasswds…).
 *
 * UAPI: https://HOST:2083/execute/<Module>/<function>
 * Auth: header `Authorization: cpanel USUARIO:TOKEN`
 */

import { lookup } from "dns/promises";
import { isIP } from "net";
import { prisma } from "./prisma";
import { decryptSecret } from "./crypto";

/** Portas aceitas: 2083 (cPanel SSL) e 443 (proxy cpanel.dominio.com). */
export const CPANEL_ALLOWED_PORTS = [2083, 443] as const;

const REQUEST_TIMEOUT_MS = 15_000;

export class CpanelError extends Error {}

// ─── Validação de entrada ────────────────────────────────────────────────────

/** "https://Cliente.com.br:2083/" → "cliente.com.br". Lança se não for um host válido. */
export function normalizeCpanelHost(input: string): string {
  let h = String(input ?? "").trim().toLowerCase();
  h = h.replace(/^[a-z]+:\/\//, ""); // protocolo
  h = h.split(/[/?#]/)[0];           // caminho
  h = h.replace(/:\d+$/, "");        // porta
  if (!h) throw new CpanelError("Informe o endereço do cPanel (ex: cliente.com.br).");
  if (h.length > 253) throw new CpanelError("Endereço do cPanel longo demais.");
  if (isIP(h)) {
    if (isPrivateAddress(h)) throw new CpanelError("Endereço interno não é permitido.");
    return h;
  }
  // Nome de domínio com pelo menos um ponto — barra "localhost", "db", etc.
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h)) {
    throw new CpanelError("Endereço do cPanel inválido. Use só o domínio, ex: cliente.com.br.");
  }
  return h;
}

export function normalizeCpanelPort(input: unknown): number {
  const p = input === undefined || input === null || input === "" ? 2083 : Number(input);
  if (!CPANEL_ALLOWED_PORTS.includes(p as (typeof CPANEL_ALLOWED_PORTS)[number])) {
    throw new CpanelError(`Porta não permitida. Use ${CPANEL_ALLOWED_PORTS.join(" ou ")}.`);
  }
  return p;
}

export function normalizeCpanelUsername(input: string): string {
  const u = String(input ?? "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(u)) {
    throw new CpanelError("Usuário do cPanel inválido.");
  }
  return u;
}

/** Token de API do cPanel: letras e números, sem espaço (evita injeção no header). */
export function normalizeCpanelToken(input: string): string {
  const t = String(input ?? "").trim();
  if (!/^[A-Za-z0-9]{16,128}$/.test(t)) {
    throw new CpanelError("Token inválido. Cole o token gerado em cPanel → Manage API Tokens (só letras e números).");
  }
  return t;
}

/**
 * Pasta relativa à home da conta. Recusa vazio (seria a conta inteira), "..",
 * e qualquer segmento oculto.
 */
export function normalizeCpanelDir(input: string, opts: { allowEmpty?: boolean } = {}): string {
  const raw = String(input ?? "").trim().replace(/\\/g, "/");
  const parts = raw.split("/").filter((s) => s !== "");
  if (parts.length === 0) {
    if (opts.allowEmpty) return "";
    throw new CpanelError("Informe a pasta de publicação (ex: public_html).");
  }
  for (const seg of parts) {
    if (seg === "." || seg === "..") throw new CpanelError("A pasta não pode conter \"..\".");
    if (seg.startsWith(".")) throw new CpanelError("Pastas ocultas (começando com ponto) não são permitidas.");
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(seg)) {
      throw new CpanelError("Pasta inválida: use só letras, números, ponto, hífen e sublinhado.");
    }
  }
  if (parts.length > 12) throw new CpanelError("Pasta com níveis demais.");
  return parts.join("/");
}

/**
 * Caminho final de uma publicação, SEMPRE dentro de publishDir.
 * resolveCpanelPath("public_html", "lp/black-friday") → "public_html/lp/black-friday"
 */
export function resolveCpanelPath(publishDir: string, subPath?: string | null): string {
  const base = normalizeCpanelDir(publishDir);
  const sub = normalizeCpanelDir(subPath ?? "", { allowEmpty: true });
  return sub ? `${base}/${sub}` : base;
}

export function normalizeSiteUrl(input: unknown): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new CpanelError("URL do site inválida.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new CpanelError("URL do site inválida.");
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

// ─── SSRF ────────────────────────────────────────────────────────────────────

function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) ||           // link-local / metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::1" || x === "::") return true;
    if (x.startsWith("fc") || x.startsWith("fd")) return true; // ULA
    if (/^fe[89ab]/.test(x)) return true;                      // link-local
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true; // não é IP → trata como inseguro
}

/** Resolve o host e recusa se QUALQUER endereço for interno. */
async function assertPublicHost(host: string): Promise<void> {
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new CpanelError("Endereço interno não é permitido.");
    return;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new CpanelError(`Não achei o servidor "${host}". Confira o endereço do cPanel.`);
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new CpanelError("Esse endereço aponta pra rede interna e não é permitido.");
  }
}

// ─── Chamada à UAPI ──────────────────────────────────────────────────────────

export interface CpanelConn {
  host: string;
  port: number;
  username: string;
  token: string; // texto claro — só em memória
}

/** Chama uma função da UAPI. Erros nunca carregam o token. */
export async function cpanelRequest<T = unknown>(
  conn: CpanelConn,
  module: string,
  fn: string,
  params: Record<string, string> = {},
  opts: {
    method?: "GET" | "POST";
    /** multipart (upload): vai no corpo; `params` ficam na URL — nunca ponha segredo neles. */
    form?: FormData;
    /** Devolve a resposta inteira mesmo com status 0 (upload diz o motivo por arquivo). */
    raw?: boolean;
  } = {},
): Promise<T> {
  // POST manda os parâmetros no corpo — obrigatório pra qualquer chamada que
  // leve senha, senão ela ficaria na URL (e nos logs de acesso do servidor).
  const method = opts.form ? "POST" : opts.method ?? "GET";
  const urlencodedBody = method === "POST" && !opts.form;
  if (!/^[A-Za-z0-9_]+$/.test(module) || !/^[A-Za-z0-9_]+$/.test(fn)) {
    throw new CpanelError("Chamada inválida.");
  }
  await assertPublicHost(conn.host);

  const hostPart = isIP(conn.host) === 6 ? `[${conn.host}]` : conn.host;
  const url = new URL(`https://${hostPart}:${conn.port}/execute/${module}/${fn}`);
  if (!urlencodedBody) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `cpanel ${conn.username}:${conn.token}`,
        Accept: "application/json",
        ...(urlencodedBody ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(urlencodedBody ? { body: new URLSearchParams(params).toString() } : {}),
      ...(opts.form ? { body: opts.form } : {}),
      redirect: "manual", // redirect levaria o header de autorização pra outro host
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    const err = e as { cause?: { code?: string }; code?: string; name?: string };
    const code = err?.cause?.code || err?.code || err?.name || "";
    if (code === "TimeoutError" || code === "ABORT_ERR" || code === "UND_ERR_CONNECT_TIMEOUT") {
      throw new CpanelError("O cPanel não respondeu a tempo. Confira o endereço e a porta.");
    }
    if (/CERT|SSL|TLS|ALTNAME/i.test(String(code))) {
      throw new CpanelError("O certificado de segurança desse endereço não confere. Use o nome do servidor da hospedagem (ex: srv12.hospedagem.com) em vez do domínio do cliente.");
    }
    if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EHOSTUNREACH") {
      throw new CpanelError("Não consegui conectar no cPanel. Confira o endereço e a porta.");
    }
    throw new CpanelError("Falha ao conectar no cPanel.");
  }

  if (res.status === 401 || res.status === 403) {
    throw new CpanelError("O cPanel recusou o acesso. Confira o usuário e o token (ele pode ter sido revogado ou expirado).");
  }
  if (res.status >= 300 && res.status < 400) {
    throw new CpanelError("Esse endereço redireciona pra outro lugar. Use o endereço direto do cPanel.");
  }
  if (!res.ok) throw new CpanelError(`O cPanel respondeu com erro (HTTP ${res.status}).`);

  let json: { status?: number; errors?: unknown[] | null; data?: unknown } | null;
  try {
    json = await res.json();
  } catch {
    throw new CpanelError("A resposta não parece ser de um cPanel. Confira o endereço e a porta.");
  }
  if (opts.raw) return json as T;
  if (!json || json.status !== 1) {
    const msg = Array.isArray(json?.errors) && json.errors.length ? String(json.errors[0]) : "erro desconhecido";
    throw new CpanelError(`cPanel: ${msg.slice(0, 300)}`);
  }
  return json.data as T;
}

/** Carrega a conexão de uma empresa já com o token decifrado. */
export async function getCpanelConn(companyId: string): Promise<(CpanelConn & { publishDir: string; siteUrl: string | null }) | null> {
  const cfg = await prisma.cpanelIntegration.findUnique({ where: { companyId } });
  if (!cfg) return null;
  let token: string;
  try {
    token = decryptSecret(cfg.tokenEnc);
  } catch {
    throw new CpanelError("Não consegui abrir o token salvo. Cadastre o token de novo.");
  }
  return { host: cfg.host, port: cfg.port, username: cfg.username, token, publishDir: cfg.publishDir, siteUrl: cfg.siteUrl };
}

/**
 * Testa a conexão listando a pasta de publicação — valida de uma vez o
 * endereço, o token e a existência da pasta. Grava o resultado na integração.
 */
export async function testCpanelConnection(companyId: string): Promise<{ ok: boolean; message: string }> {
  let result: { ok: boolean; message: string };
  try {
    const conn = await getCpanelConn(companyId);
    if (!conn) return { ok: false, message: "cPanel não configurado para este cliente." };
    const files = await cpanelRequest<unknown[]>(conn, "Fileman", "list_files", { dir: conn.publishDir });
    const n = Array.isArray(files) ? files.length : 0;
    result = { ok: true, message: `Conectado. A pasta "${conn.publishDir}" existe e tem ${n} ${n === 1 ? "item" : "itens"}.` };
  } catch (e) {
    result = { ok: false, message: e instanceof CpanelError ? e.message : "Falha inesperada ao testar o cPanel." };
  }
  await prisma.cpanelIntegration.updateMany({
    where: { companyId },
    data: {
      lastTestedAt: new Date(),
      lastError: result.ok ? null : result.message,
      status: result.ok ? "ACTIVE" : "ERROR",
    },
  });
  return result;
}

// ─── E-mail e espaço da conta ────────────────────────────────────────────────
//
// Atenção: `publishDir` NÃO limita nada aqui — caixas de e-mail e cota valem
// pra conta inteira do cPanel. A trava é de quem pode chamar (ADMIN/SUPER_ADMIN
// nas rotas) + auditoria de toda criação e troca de senha.

export const CPANEL_MIN_PASSWORD = 10;

/** Parte antes do @. Mesmas regras do cPanel: letras, números, ponto, hífen, sublinhado. */
export function normalizeMailboxLocal(input: unknown): string {
  const l = String(input ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/.test(l) || l.includes("..")) {
    throw new CpanelError("Nome da caixa inválido. Use letras, números, ponto, hífen ou sublinhado (ex: contato).");
  }
  return l;
}

export function normalizeMailDomain(input: unknown): string {
  const d = String(input ?? "").trim().toLowerCase();
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) {
    throw new CpanelError("Domínio do e-mail inválido.");
  }
  return d;
}

/** "contato@cliente.com.br" → { local, domain } */
export function splitMailbox(input: unknown): { local: string; domain: string } {
  const raw = String(input ?? "").trim();
  const at = raw.lastIndexOf("@");
  if (at < 1) throw new CpanelError("Informe o e-mail completo (ex: contato@cliente.com.br).");
  return { local: normalizeMailboxLocal(raw.slice(0, at)), domain: normalizeMailDomain(raw.slice(at + 1)) };
}

/** Senha de caixa de e-mail. A força final quem decide é o cPanel do servidor. */
export function normalizeMailboxPassword(input: unknown): string {
  const p = typeof input === "string" ? input : "";
  if (p.length < CPANEL_MIN_PASSWORD) throw new CpanelError(`A senha precisa de pelo menos ${CPANEL_MIN_PASSWORD} caracteres.`);
  if (p.length > 128) throw new CpanelError("Senha longa demais (máximo 128 caracteres).");
  if (/[\x00-\x1f\x7f]/.test(p) || p !== p.trim()) {
    throw new CpanelError("A senha não pode ter quebra de linha nem espaço no começo ou no fim.");
  }
  return p;
}

/** Cota da caixa em MB. Vazio/0 = sem limite. */
export function normalizeMailboxQuota(input: unknown): number {
  if (input === undefined || input === null || input === "") return 0;
  const q = Number(input);
  if (!Number.isInteger(q) || q < 0 || q > 1_000_000) throw new CpanelError("Cota inválida. Informe em MB (0 = sem limite).");
  return q;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Limite em MB; 0, "unlimited" e ausente viram null (sem limite). */
function toLimitMb(v: unknown): number | null {
  const n = toNumber(v);
  return n && n > 0 ? n : null;
}

async function requireConn(companyId: string) {
  const conn = await getCpanelConn(companyId);
  if (!conn) throw new CpanelError("cPanel não configurado para este cliente.");
  return conn;
}

export interface CpanelUsage {
  usedMb: number;
  limitMb: number | null; // null = sem limite
}

/** Espaço em disco usado e contratado da conta inteira. */
export async function getCpanelUsage(conn: CpanelConn): Promise<CpanelUsage> {
  const d = await cpanelRequest<Record<string, unknown>>(conn, "Quota", "get_quota_info");
  return { usedMb: toNumber(d?.megabytes_used) ?? 0, limitMb: toLimitMb(d?.megabyte_limit) };
}

export interface CpanelMailbox {
  email: string;
  usedMb: number;
  quotaMb: number | null; // null = sem limite
  suspended: boolean;
}

/** Caixas de e-mail da conta com o uso de cada uma. */
export async function listCpanelMailboxes(conn: CpanelConn): Promise<CpanelMailbox[]> {
  const rows = await cpanelRequest<Record<string, unknown>[]>(conn, "Email", "list_pops_with_disk");
  return (Array.isArray(rows) ? rows : [])
    .map((r) => {
      const bytes = toNumber(r._diskused);
      return {
        email: String(r.email ?? ""),
        usedMb: bytes !== null ? bytes / (1024 * 1024) : toNumber(r.diskused) ?? 0,
        quotaMb: toLimitMb(r.diskquota),
        suspended: Number(r.suspended_login) === 1 || Number(r.suspended_incoming) === 1,
      };
    })
    .filter((m) => m.email.includes("@"))
    .sort((a, b) => a.email.localeCompare(b.email));
}

/** Domínios da conta que aceitam caixa de e-mail. */
export async function listCpanelMailDomains(conn: CpanelConn): Promise<string[]> {
  const rows = await cpanelRequest<{ domain?: string }[]>(conn, "Email", "list_mail_domains");
  return (Array.isArray(rows) ? rows : []).map((r) => String(r.domain ?? "").toLowerCase()).filter(Boolean);
}

/** Visão geral: espaço da conta + caixas + domínios. */
export async function getCpanelEmailOverview(companyId: string) {
  const conn = await requireConn(companyId);
  const [usage, mailboxes, domains] = await Promise.all([
    getCpanelUsage(conn),
    listCpanelMailboxes(conn),
    listCpanelMailDomains(conn),
  ]);
  return { usage, mailboxes, domains };
}

/** Cria uma caixa de e-mail. Só em domínio que já pertence à conta. */
export async function createCpanelMailbox(
  companyId: string,
  input: { local: string; domain: string; password: string; quotaMb: number },
): Promise<{ email: string }> {
  const conn = await requireConn(companyId);
  const domains = await listCpanelMailDomains(conn);
  if (!domains.includes(input.domain)) {
    throw new CpanelError(`O domínio "${input.domain}" não pertence a esta conta do cPanel.`);
  }
  await cpanelRequest(
    conn, "Email", "add_pop",
    {
      email: input.local, domain: input.domain, password: input.password,
      quota: String(input.quotaMb), send_welcome_email: "0",
    },
    { method: "POST" },
  );
  return { email: `${input.local}@${input.domain}` };
}

/** Troca a senha de uma caixa que já existe. */
export async function changeCpanelMailboxPassword(
  companyId: string,
  input: { local: string; domain: string; password: string },
): Promise<{ email: string }> {
  const conn = await requireConn(companyId);
  const email = `${input.local}@${input.domain}`;
  const boxes = await listCpanelMailboxes(conn);
  if (!boxes.some((b) => b.email.toLowerCase() === email)) {
    throw new CpanelError(`A caixa ${email} não existe nesta conta.`);
  }
  await cpanelRequest(
    conn, "Email", "passwd_pop",
    { email: input.local, domain: input.domain, password: input.password },
    { method: "POST" },
  );
  return { email };
}

export interface MailClientSettings {
  email: string;
  username: string;            // login no app de e-mail = o endereço completo
  incomingHost: string;
  imapPort: number;            // SSL/TLS
  pop3Port: number;            // SSL/TLS
  smtpHost: string;
  smtpPort: number;            // SSL/TLS
  smtpStartTlsPort: number;    // alternativa quando a rede bloqueia a 465
  webmailUrl: string;
}

function toPort(v: unknown, fallback: number): number {
  const n = toNumber(v);
  return n && Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
}

/** Só hostname (nada de esquema, porta ou caminho) — vai virar texto de instrução. */
function cleanMailHost(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s) ? s : null;
}

/**
 * Dados pra configurar a caixa no Outlook, Apple Mail, Gmail, celular etc.
 * Vêm do próprio cPanel (Email::get_client_settings), que devolve o servidor
 * com certificado válido; se o cPanel não responder os hosts, cai no padrão
 * mail.<domínio>. Portas SSL padrão do cPanel: IMAP 993, POP3 995, SMTP 465
 * (ou 587 com STARTTLS). Não lê nem mexe em senha.
 */
export async function getCpanelMailClientSettings(companyId: string, emailInput: unknown): Promise<MailClientSettings> {
  const { local, domain } = splitMailbox(emailInput);
  const email = `${local}@${domain}`;
  const conn = await requireConn(companyId);
  const boxes = await listCpanelMailboxes(conn);
  if (!boxes.some((b) => b.email.toLowerCase() === email)) {
    throw new CpanelError(`A caixa ${email} não existe nesta conta.`);
  }
  const d = await cpanelRequest<Record<string, unknown>>(conn, "Email", "get_client_settings", { account: email });
  return buildMailClientSettings(email, d);
}

/** Monta as instruções a partir da resposta do get_client_settings (separado pra testar). */
export function buildMailClientSettings(email: string, d: Record<string, unknown> | null | undefined): MailClientSettings {
  const domain = email.split("@")[1] ?? "";
  const incomingHost = cleanMailHost(d?.inbox_host) ?? cleanMailHost(d?.mail_domain) ?? `mail.${domain}`;
  const smtpHost = cleanMailHost(d?.smtp_host) ?? incomingHost;
  const imapPort = d?.inbox_service === "imap" ? toPort(d?.inbox_port, 993) : 993;
  return {
    email,
    username: email,
    incomingHost,
    imapPort,
    pop3Port: 995,
    smtpHost,
    smtpPort: toPort(d?.smtp_port, 465),
    smtpStartTlsPort: 587,
    webmailUrl: `https://${incomingHost}:2096`,
  };
}

// ─── Envio de arquivos (site estático) ───────────────────────────────────────
//
// Fileman::upload_files (multipart). O cPanel cria a pasta se não existir e,
// com overwrite=0, recusa arquivo que já existe — é assim que o GoHub pergunta
// antes de substituir. Tudo cai dentro de publishDir (resolveCpanelPath).
//
// Só tipos de site estático: .php/.cgi/.phtml etc. EXECUTARIAM no servidor do
// cliente, e arquivo começando com ponto (.htaccess) muda a configuração dele.

export const CPANEL_UPLOAD_EXTENSIONS = [
  "html", "htm", "css", "js", "mjs", "json", "map", "txt", "xml", "webmanifest",
  "svg", "png", "jpg", "jpeg", "gif", "webp", "avif", "ico",
  "woff", "woff2", "ttf", "otf", "eot",
  "pdf", "mp4", "webm", "mp3", "ogg",
] as const;
export const CPANEL_UPLOAD_MAX_FILES = 50;
export const CPANEL_UPLOAD_MAX_BYTES = 25 * 1024 * 1024; // por envio, somando tudo

/** Nome do arquivo final. Lança se for tipo não permitido ou nome perigoso. */
export function normalizeUploadFileName(input: unknown): string {
  const n = String(input ?? "").trim().split(/[\\/]/).pop() ?? "";
  if (!n || n.startsWith(".")) throw new CpanelError(`Nome de arquivo inválido: "${n || "(vazio)"}".`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/.test(n)) {
    throw new CpanelError(`"${n}": use só letras, números, ponto, hífen e sublinhado no nome (sem espaço nem acento).`);
  }
  const ext = n.includes(".") ? n.split(".").pop()!.toLowerCase() : "";
  if (!(CPANEL_UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new CpanelError(`"${n}": tipo não permitido. Aceitos: ${CPANEL_UPLOAD_EXTENSIONS.join(", ")}.`);
  }
  return n;
}

/** Link público de um arquivo publicado, se a integração tiver a URL do site. */
export function publicUrlFor(siteUrl: string | null, subPath: string, fileName: string): string | null {
  if (!siteUrl) return null;
  // index.html abre pela pasta: https://site/lp/ em vez de https://site/lp/index.html
  if (fileName === "index.html") return `${siteUrl}/${subPath ? `${subPath}/` : ""}`;
  return `${siteUrl}/${subPath ? `${subPath}/` : ""}${fileName}`;
}

export interface CpanelUploadResult {
  file: string;
  ok: boolean;
  /** Já existia e não foi substituído (mande de novo com overwrite pra trocar). */
  exists: boolean;
  reason: string | null;
  url: string | null;
}

/**
 * Envia arquivos pra `publishDir/subPath`. Nunca substitui sem `overwrite`.
 * Erro geral (conexão, token) lança CpanelError; falha por arquivo volta no resultado.
 */
export async function uploadCpanelFiles(
  companyId: string,
  input: { subPath?: string | null; files: { name: string; data: Blob }[]; overwrite?: boolean },
): Promise<{ dir: string; subPath: string; results: CpanelUploadResult[] }> {
  if (input.files.length === 0) throw new CpanelError("Escolha pelo menos um arquivo.");
  if (input.files.length > CPANEL_UPLOAD_MAX_FILES) throw new CpanelError(`No máximo ${CPANEL_UPLOAD_MAX_FILES} arquivos por envio.`);
  const total = input.files.reduce((s, f) => s + f.data.size, 0);
  if (total > CPANEL_UPLOAD_MAX_BYTES) throw new CpanelError("Envio grande demais (máximo 25 MB somando os arquivos).");

  const names = input.files.map((f) => normalizeUploadFileName(f.name));
  const dupe = names.find((n, i) => names.indexOf(n) !== i);
  if (dupe) throw new CpanelError(`O arquivo "${dupe}" foi escolhido duas vezes.`);

  const conn = await requireConn(companyId);
  const subPath = normalizeCpanelDir(input.subPath ?? "", { allowEmpty: true });
  const dir = resolveCpanelPath(conn.publishDir, subPath);

  const form = new FormData();
  input.files.forEach((f, i) => form.append(`file-${i}`, f.data, names[i]));

  type Up = { file?: string; reason?: string; status?: number };
  const json = await cpanelRequest<{ status?: number; errors?: unknown[] | null; data?: { uploads?: Up[] } | null }>(
    conn, "Fileman", "upload_files",
    { dir, overwrite: input.overwrite ? "1" : "0" },
    { form, raw: true },
  );
  const uploads = json?.data?.uploads ?? [];
  if (uploads.length === 0) {
    const msg = Array.isArray(json?.errors) && json.errors.length ? String(json.errors[0]) : "o cPanel não aceitou os arquivos";
    throw new CpanelError(`cPanel: ${msg.slice(0, 300)}`);
  }

  const results = names.map<CpanelUploadResult>((name) => {
    const u = uploads.find((x) => x.file === name);
    const ok = u?.status === 1;
    const reason = ok ? null : String(u?.reason ?? "não enviado").slice(0, 300);
    return {
      file: name,
      ok,
      exists: !ok && /exist/i.test(reason ?? ""),
      reason,
      url: ok ? publicUrlFor(conn.siteUrl, subPath, name) : null,
    };
  });
  return { dir, subPath, results };
}
