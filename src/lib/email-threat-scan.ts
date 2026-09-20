/**
 * Análise local de ameaça em email — links e anexos, sem serviço externo.
 *
 * Roda no ingest (marca `suspicious` + `suspiciousReasons`) e na tela (painel
 * de links do leitor), por isso NÃO importa prisma nem nada de servidor:
 * regex puro, funciona nos dois lados.
 *
 * O objetivo não é antivírus — é pegar o padrão do golpe brasileiro de caixa
 * de PME (boleto falso, "nota fiscal", "intimação"): link que mostra um
 * domínio e aponta pra outro, anexo executável disfarçado de documento.
 * Complementa a heurística de remetente em imap-inbox.ts.
 */

/** Extensões que praticamente nunca são anexo legítimo em email comercial. */
const EXEC_EXT = /\.(exe|com|pif|scr|bat|cmd|js|jse|vbs|vbe|wsf|wsh|hta|msi|msp|jar|apk|lnk|iso|img|ps1|reg|dll|cpl)$/i;
/** Documento de verdade seguido de executável: "boleto.pdf.exe". */
const DOUBLE_EXT = /\.(pdf|jpe?g|png|gif|docx?|xlsx?|pptx?|txt|csv|zip|rar)\.([a-z0-9]{2,4})$/i;
/** Office com macro — vetor clássico de malware. */
const MACRO_EXT = /\.(docm|dotm|xlsm|xltm|xlsb|pptm|potm)$/i;
/** HTML anexado = página de phishing offline. */
const HTML_EXT = /\.(html?|shtml|mht|mhtml)$/i;
/** Marcas de direção Unicode usadas pra inverter a exibição do nome. */
const RLO_CHARS = /[‪-‮⁦-⁩]/;
/** MIME declarado de executável. */
const EXEC_MIME = /^application\/(x-msdownload|x-msdos-program|x-executable|x-dosexec|vnd\.microsoft\.portable-executable|x-sh|x-bat)$/i;

/**
 * Domínios de rastreio de ESP (RD Station, Mailchimp, SendGrid...). Newsletter
 * legítima mostra "site-da-marca.com.br" no texto e aponta pro redirecionador
 * do ESP — sem esta lista, todo email marketing viraria "golpe".
 */
const TRACKING_DOMAINS = new Set([
  "sendgrid.net", "list-manage.com", "mailchimp.com", "mcsv.net", "rdstation.com.br",
  "rdstation.com", "hubspotlinks.com", "hs-sites.com", "mailgun.org", "sparkpostmail.com",
  "amazonses.com", "mandrillapp.com", "klclick.com", "klclick1.com", "sendinblue.com",
  "brevo.com", "activehosted.com", "aweber.com", "constantcontact.com", "exct.net",
  "e-goi.com", "leadlovers.site", "mailerlite.com", "sendpulse.com", "getresponse.com",
  "omnisend.com", "doppler.io", "dpbolvw.net", "mkt.com", "ctrk.klclick.com",
]);

const SHORTENERS = new Set([
  "bit.ly", "tinyurl.com", "goo.gl", "t.co", "ow.ly", "is.gd", "buff.ly",
  "cutt.ly", "rebrand.ly", "shorturl.at", "encurtador.com.br", "bit.do",
  "rb.gy", "tiny.cc", "acesse.one", "n9.cl",
]);

/** Palavras que indicam que o link pede ação sensível (dado, dinheiro, login). */
const SENSITIVE_ACTION = /login|senha|password|pagar|pagamento|boleto|fatura|segunda-via|2via|cpf|cnpj|cart[aã]o|atualizar|recadastr|desbloque|regulariz/i;

export type LinkRisk = "high" | "warn" | "ok";

export interface EmailLink {
  /** URL de destino, como está no href. */
  href: string;
  /** Domínio real do destino ("" quando não dá pra parsear). */
  host: string;
  /** Texto clicável, já sem tags HTML. */
  text: string;
  risk: LinkRisk;
  /** Motivos legíveis (vazio quando risk = "ok"). */
  reasons: string[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Domínio registrável aproximado: "a.b.dominio.com.br" → "dominio.com.br". */
export function rootDomain(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, "");
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  const twoLevel = /^(com|net|org|gov|edu|adv|eng|jus|leg|mil|art|ind|esp)\.[a-z]{2}$/;
  const lastTwo = parts.slice(-2).join(".");
  return twoLevel.test(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

/** Procura algo com cara de domínio dentro do texto clicável do link. */
function domainInText(text: string): string | null {
  const m = text.match(/\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?=[\/\s)]|$)/i);
  return m ? m[1].toLowerCase().replace(/^www\./, "") : null;
}

/**
 * Avalia UM link. `senderDomain` é o domínio do remetente — link que sai do
 * domínio de quem escreveu é sinal, não prova, então só pesa junto com outros.
 */
export function analyzeLink(href: string, text: string, senderDomain?: string | null): EmailLink {
  const reasons: string[] = [];
  const clean = href.trim();
  const label = stripTags(text).slice(0, 120);

  if (/^javascript:/i.test(clean)) {
    return { href: clean, host: "", text: label, risk: "high", reasons: ["Link executa script (javascript:) em vez de abrir uma página"] };
  }
  if (/^data:/i.test(clean)) {
    return { href: clean, host: "", text: label, risk: "high", reasons: ["Link carrega conteúdo embutido (data:) — técnica de phishing"] };
  }

  let url: URL | null = null;
  try {
    url = new URL(clean);
  } catch {
    return { href: clean, host: "", text: label, risk: "ok", reasons: [] };
  }
  const host = url.hostname.toLowerCase();

  // Truque do "@": tudo antes dele é ignorado pelo navegador.
  if (url.username || clean.split("?")[0].includes("@")) {
    reasons.push(`Link disfarçado com "@" — abre em ${host}, não no endereço mostrado`);
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    reasons.push(`Link aponta para um endereço IP (${host}) em vez de um domínio`);
  }
  if (host.includes("xn--")) {
    reasons.push(`Domínio do link imita um nome usando caracteres especiais (${host})`);
  }
  if (EXEC_EXT.test(url.pathname)) {
    reasons.push(`Link baixa um programa executável (${url.pathname.split("/").pop()})`);
  }

  // O sinal mais forte: o texto mostra um domínio e o destino é outro.
  let trackingMismatch: string | null = null;
  const shown = domainInText(label);
  if (shown && host) {
    const shownRoot = rootDomain(shown);
    const realRoot = rootDomain(host);
    if (shownRoot !== realRoot) {
      // Redirecionador de ESP é o caso legítimo desse "mismatch" — vira
      // aviso no painel, não acusação de golpe.
      if (TRACKING_DOMAINS.has(realRoot)) {
        trackingMismatch = `Link passa pelo rastreador ${realRoot} antes de chegar em ${shown}`;
      } else {
        reasons.push(`O link diz "${shown}" mas abre em ${host}`);
      }
    }
  }

  const high = reasons.length > 0;

  // Sinais de atenção (sozinhos não condenam).
  const warns: string[] = [];
  if (trackingMismatch) warns.push(trackingMismatch);
  if (SHORTENERS.has(rootDomain(host))) {
    warns.push(`Link encurtado (${rootDomain(host)}) — o destino real fica escondido`);
  }
  if (url.protocol === "http:" && SENSITIVE_ACTION.test(clean + " " + label)) {
    warns.push("Link pede dados/pagamento em conexão sem HTTPS");
  }
  if (senderDomain && host && SENSITIVE_ACTION.test(clean + " " + label)) {
    const realRoot = rootDomain(host);
    if (realRoot !== rootDomain(senderDomain) && !TRACKING_DOMAINS.has(realRoot)) {
      warns.push(`Link de pagamento/cadastro sai para ${realRoot}, fora do domínio de quem enviou`);
    }
  }

  return {
    href: clean,
    host,
    text: label,
    risk: high ? "high" : warns.length ? "warn" : "ok",
    reasons: high ? reasons : warns,
  };
}

/** Extrai e avalia todos os links de um email (dedup por destino). */
export function analyzeLinks(html: string | null | undefined, senderEmail?: string | null): EmailLink[] {
  if (!html) return [];
  const senderDomain = senderEmail?.split("@")[1] ?? null;
  const out: EmailLink[] = [];
  const seen = new Set<string>();
  const A_TAG = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = A_TAG.exec(html)) !== null) {
    const href = decodeEntities(m[1]).trim();
    if (!href || /^(mailto:|tel:|#)/i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(analyzeLink(href, m[2], senderDomain));
    if (out.length >= 60) break;
  }
  return out;
}

export interface ScannedAttachment {
  filename: string;
  contentType?: string | null;
}

/** Avalia UM anexo pelos metadados (nome + MIME) — não precisa baixar nada. */
export function analyzeAttachment(a: ScannedAttachment): { risk: LinkRisk; reasons: string[] } {
  const reasons: string[] = [];
  const name = (a.filename || "").trim();
  const mime = (a.contentType || "").trim();

  if (RLO_CHARS.test(name)) {
    reasons.push(`Anexo "${name.replace(RLO_CHARS, "")}" usa caractere invisível pra esconder a extensão real`);
  }
  const dbl = name.match(DOUBLE_EXT);
  if (dbl && EXEC_EXT.test(`.${dbl[2]}`)) {
    reasons.push(`Anexo "${name}" finge ser ${dbl[1].toUpperCase()} mas é um executável .${dbl[2]}`);
  } else if (EXEC_EXT.test(name)) {
    reasons.push(`Anexo "${name}" é um programa executável — não abra`);
  }
  if (EXEC_MIME.test(mime)) {
    reasons.push(`Anexo "${name}" é declarado como executável pelo servidor (${mime})`);
  }
  if (MACRO_EXT.test(name)) {
    reasons.push(`Anexo "${name}" é documento com macro do Office — vetor comum de vírus`);
  }
  if (HTML_EXT.test(name)) {
    reasons.push(`Anexo "${name}" é uma página HTML — golpe costuma usar isso pra imitar tela de login`);
  }

  const high = reasons.some((r) => /executável|macro|invisível/i.test(r));
  return { risk: reasons.length ? (high ? "high" : "warn") : "ok", reasons };
}

/**
 * Varredura completa do email recebido. Retorna os motivos de suspeita —
 * lista vazia = nada encontrado.
 */
export function scanEmailThreats(input: {
  html?: string | null;
  fromEmail?: string | null;
  attachments?: ScannedAttachment[];
}): string[] {
  const reasons: string[] = [];

  for (const l of analyzeLinks(input.html, input.fromEmail)) {
    if (l.risk === "high") reasons.push(...l.reasons);
  }
  for (const a of input.attachments ?? []) {
    const r = analyzeAttachment(a);
    if (r.risk !== "ok") reasons.push(...r.reasons);
  }

  // Dedup + teto: o banner precisa ser lido, não varrido.
  return [...new Set(reasons)].slice(0, 6);
}
