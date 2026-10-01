/**
 * Limpeza do HTML da assinatura de email.
 *
 * O conteúdo é escrito pelo próprio admin da empresa, então o objetivo não é
 * conter um atacante remoto — é impedir que um trecho colado de qualquer
 * lugar execute script na nossa tela ou vá embutido no email enviado.
 * Cliente de email já ignora script; o risco real é o nosso editor.
 */

/** Tags que não têm razão de existir numa assinatura. */
const TAGS_PROIBIDAS = "script|style|iframe|object|embed|form|input|button|meta|link|base|svg";

export function sanitizeSignatureHtml(input: string | null | undefined): string {
  if (!input) return "";
  let html = String(input);

  // Bloco inteiro (com conteúdo) e tag solta/auto-fechada.
  html = html.replace(new RegExp(`<\\s*(${TAGS_PROIBIDAS})\\b[\\s\\S]*?<\\/\\s*\\1\\s*>`, "gi"), "");
  html = html.replace(new RegExp(`<\\s*\\/?\\s*(${TAGS_PROIBIDAS})\\b[^>]*>`, "gi"), "");

  // Handlers inline (onclick, onerror…).
  html = html.replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // Endereços executáveis em link/imagem.
  html = html.replace(/(href|src)\s*=\s*(["'])\s*(javascript|vbscript):[^"']*\2/gi, '$1="#"');
  html = html.replace(/(href|src)\s*=\s*(javascript|vbscript):[^\s>]*/gi, '$1="#"');

  return html.trim();
}

/** Parece HTML? Assinatura antiga foi salva como texto puro. */
export function looksLikeHtml(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s);
}

/** Versão em texto puro — vai na parte text/plain do email enviado. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|tr|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
