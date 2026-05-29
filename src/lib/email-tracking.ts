/**
 * Pega o HTML já renderizado de uma campanha e injeta:
 *  - Pixel de abertura (img 1x1 invisível antes de </body>)
 *  - Wrapping de todos os <a href="..."> → /api/email/track/click (redirect)
 *  - Footer com link de descadastro (compliance LGPD)
 *
 * Tudo amarrado ao `token` único do EmailRecipient — assim cada destinatário
 * tem seu próprio rastro mesmo que o template seja o mesmo.
 *
 * Também devolve o header `List-Unsubscribe` pronto pra colocar no envio.
 */

const TRACK_OPEN_PATH = "/api/email/track/open";
const TRACK_CLICK_PATH = "/api/email/track/click";
const UNSUBSCRIBE_PATH = "/unsubscribe";

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL
    ?? process.env.NEXTAUTH_URL
    ?? "http://localhost:3000"
  ).replace(/\/$/, "");
}

function encodeUrlForRedirect(url: string): string {
  // base64url-safe (sem +/=)
  return Buffer.from(url, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeRedirectUrl(b64url: string): string | null {
  try {
    let s = b64url.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return Buffer.from(s, "base64").toString("utf8");
  } catch {
    return null;
  }
}

export interface InjectedEmail {
  html: string;
  /** Valor pro header `List-Unsubscribe` (RFC 2369 + 8058). */
  listUnsubscribeHeader: string;
}

/**
 * Injeta tracking no HTML do email.
 *
 * @param html  HTML renderizado (já com {{vars}} substituídas)
 * @param token Token único do EmailRecipient
 */
export function injectTracking(html: string, token: string): InjectedEmail {
  const root = baseUrl();
  const openUrl = `${root}${TRACK_OPEN_PATH}?t=${encodeURIComponent(token)}`;
  const unsubUrl = `${root}${UNSUBSCRIBE_PATH}/${encodeURIComponent(token)}`;

  // 1) Reescrever <a href="...">  → wrapping em /api/email/track/click
  //    Pula links que já apontem pro próprio domínio (auto-referência) e mailto:/tel:
  const rewritten = html.replace(/<a\b([^>]*?)href=(["'])([^"']+)\2/gi, (full, before, q, href) => {
    const lower = href.toLowerCase();
    if (lower.startsWith("mailto:") || lower.startsWith("tel:") || lower.startsWith("#")) return full;
    if (lower.startsWith(`${root}/api/email/track/`) || lower.startsWith(`${root}${UNSUBSCRIBE_PATH}/`)) return full;
    const tracked = `${root}${TRACK_CLICK_PATH}?t=${encodeURIComponent(token)}&u=${encodeUrlForRedirect(href)}`;
    return `<a${before}href=${q}${tracked}${q}`;
  });

  // 2) Footer com unsubscribe + 3) Pixel de abertura antes de </body>
  const footer = `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #ddd;font-family:Arial,sans-serif;font-size:11px;color:#888;text-align:center;">
  Você está recebendo esse email porque está cadastrado em nossa base.
  <br>
  <a href="${unsubUrl}" style="color:#888;text-decoration:underline;">Não quero mais receber estes emails</a>
</div>
<img src="${openUrl}" width="1" height="1" alt="" style="display:none;border:0;width:1px;height:1px;" />
`.trim();

  // Insere footer antes de </body>; se não tem </body>, anexa no fim
  let withFooter: string;
  if (/<\/body>/i.test(rewritten)) {
    withFooter = rewritten.replace(/<\/body>/i, `${footer}\n</body>`);
  } else {
    withFooter = `${rewritten}\n${footer}`;
  }

  return {
    html: withFooter,
    listUnsubscribeHeader: `<${unsubUrl}>`,
  };
}
