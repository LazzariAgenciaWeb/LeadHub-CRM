/**
 * "A pessoa abriu o email?" — pixel de abertura por MENSAGEM.
 *
 * O Email Marketing já rastreia abertura por campanha (email-tracking.ts,
 * amarrado no EmailRecipient). Aqui é o equivalente pra caixa de email: cada
 * email enviado pode levar um pixel 1x1 com token próprio, e a rota pública
 * /api/email/inbox/track/open registra a abertura.
 *
 * O que esse sinal vale (e não vale):
 *  - "abriu" é confiável — alguém carregou a imagem do email;
 *  - "não abriu" NÃO prova que não leu: Outlook e vários apps bloqueiam
 *    imagem por padrão, e aí o pixel nunca carrega;
 *  - o Apple Mail com Proteção de Privacidade pré-carrega as imagens na
 *    ENTREGA, então pode marcar abertura segundos depois do envio sem
 *    ninguém ter lido.
 * Por isso a tela mostra a hora da primeira abertura e a contagem, em vez de
 * um "lido/não lido" que fingiria certeza.
 *
 * A cópia guardada no GoHub vai SEM o pixel: o leitor renderiza o HTML num
 * iframe e abrir o próprio enviado contaria como abertura do destinatário.
 */
import { randomBytes } from "crypto";

export const TRACK_OPEN_PATH = "/api/email/inbox/track/open";

/** Token do rastreio — opaco, sem nada do email dentro. */
export function newTrackToken(): string {
  return randomBytes(18).toString("base64url");
}

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL
    ?? process.env.NEXTAUTH_URL
    ?? "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function openPixelUrl(token: string, root = baseUrl()): string {
  return `${root}${TRACK_OPEN_PATH}?t=${encodeURIComponent(token)}`;
}

/** `<img>` 1x1 invisível. `alt` vazio pra não virar texto em leitor de tela. */
export function openPixelTag(token: string, root?: string): string {
  return `<img src="${openPixelUrl(token, root)}" width="1" height="1" alt="" style="display:none;border:0;width:1px;height:1px;max-width:1px;max-height:1px;" />`;
}

/**
 * Põe o pixel no fim do HTML — dentro de `</body>` quando existe, senão
 * colado no fim. Idempotente: HTML que já tem o pixel volta igual.
 */
export function injectOpenPixel(html: string, token: string, root?: string): string {
  if (!token) return html;
  if (html.includes(TRACK_OPEN_PATH)) return html;
  const tag = openPixelTag(token, root);
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${tag}\n</body>`)
    : `${html}\n${tag}`;
}
