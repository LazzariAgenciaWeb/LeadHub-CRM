/**
 * Corpo do email ENCAMINHADO.
 *
 * Encaminhar aqui não manda só a mensagem aberta: manda também as mensagens
 * ligadas a ela (a conversa). É o caso do registro.br, que dispara aviso,
 * lembrete, renovação e fatura separados — quem recebe o encaminhamento
 * precisa do fio inteiro pra resolver, não de um pedaço.
 *
 * Funções puras (texto entra, texto sai): quem busca os dados é a rota
 * /api/email/inbox/[id]/forward.
 */
import { htmlToPlainText, looksLikeHtml } from "./html-sanitize";
import { formatBrazilDateTime } from "./datetime";

/** Mensagem como o encaminhamento precisa dela. */
export type ForwardMsg = {
  direction: "IN" | "OUT";
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  ccEmail?: string | null;
  subject: string;
  textBody: string | null;
  htmlBody: string | null;
  snippet: string;
  sentAt: Date | string;
};

/** Tetos pra não gerar email gigante (nem estourar o SMTP). */
export const MAX_RELATED = 8;
export const MAX_BODY_CHARS = 4000;
export const MAX_TOTAL_CHARS = 40_000;

const PREFIXO = /^\s*(enc|fwd|fw|encaminhado)\s*:\s*/i;

/** "Fatura" → "Enc: Fatura"; "Enc: Fatura" fica como está. */
export function forwardSubject(subject: string): string {
  const limpo = (subject || "").trim();
  if (!limpo) return "Enc: (sem assunto)";
  return PREFIXO.test(limpo) ? limpo : `Enc: ${limpo}`;
}

// Fuso do sistema (SYSTEM_TIMEZONE, padrão America/Sao_Paulo): o corpo é
// montado no servidor, que pode rodar em UTC — sem isso a fatura das 09:14
// apareceria como 12:14 pra quem recebe o encaminhamento.
const dataBR = formatBrazilDateTime;

function quem(m: ForwardMsg): string {
  return m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail;
}

/** Corpo em texto puro, venha de onde vier (texto, HTML ou só o trecho). */
export function plainBody(m: ForwardMsg): string {
  const texto = (m.textBody ?? "").trim();
  if (texto) return looksLikeHtml(texto) ? htmlToPlainText(texto) : texto;
  const html = (m.htmlBody ?? "").trim();
  if (html) return htmlToPlainText(html);
  return (m.snippet ?? "").trim();
}

function corte(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n[…mensagem cortada aqui — abra o email original no GoHub pra ver o resto]`;
}

function cabecalho(m: ForwardMsg): string {
  const linhas = [
    `De: ${quem(m)}`,
    `Data: ${dataBR(m.sentAt)}`,
    `Para: ${m.toEmail || "—"}`,
  ];
  if (m.ccEmail) linhas.push(`Cc: ${m.ccEmail}`);
  linhas.push(`Assunto: ${m.subject || "(sem assunto)"}`);
  return linhas.join("\n");
}

/**
 * Monta o corpo: espaço pra escrever em cima, a mensagem encaminhada e, se
 * houver, as mensagens ligadas em ordem cronológica.
 *
 * `related` já vem SEM a mensagem principal e em ordem crescente de data.
 */
export function buildForwardBody(main: ForwardMsg, related: ForwardMsg[] = []): string {
  const partes: string[] = [
    "",
    "",
    "---------- Mensagem encaminhada ----------",
    cabecalho(main),
    "",
    corte(plainBody(main) || "(sem conteúdo)", MAX_BODY_CHARS),
  ];

  const ligadas = related.slice(0, MAX_RELATED);
  if (ligadas.length) {
    partes.push(
      "",
      `========== Mensagens ligadas a este assunto (${ligadas.length}) ==========`,
      "",
    );
    ligadas.forEach((m, i) => {
      partes.push(
        `--- ${i + 1}/${ligadas.length} · ${m.direction === "IN" ? "recebido" : "enviado"} · ${dataBR(m.sentAt)} ---`,
        cabecalho(m),
        "",
        corte(plainBody(m) || "(sem conteúdo)", MAX_BODY_CHARS),
        "",
      );
    });
    if (related.length > ligadas.length) {
      partes.push(`[+${related.length - ligadas.length} mensagem(ns) mais antiga(s) não incluída(s)]`);
    }
  }

  return corte(partes.join("\n").replace(/\n{4,}/g, "\n\n\n"), MAX_TOTAL_CHARS);
}
