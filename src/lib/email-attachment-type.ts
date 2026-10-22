/**
 * Tipo (MIME) do anexo na hora de ENVIAR.
 *
 * O navegador às vezes entrega `file.type` vazio ou "application/octet-stream"
 * (arquivo vindo de pen drive, de app que não declara o tipo, de download
 * antigo). Quando isso acontece, o email sai com o anexo marcado como "binário
 * genérico" e parte dos clientes de email — Outlook e alguns webmails — se
 * recusa a abrir ou renomeia pra .bin: o arquivo chega, mas o destinatário não
 * consegue abrir. Aqui o tipo é deduzido da extensão nesse caso.
 *
 * Isomórfico de propósito (só string): roda no navegador, na rota de envio e
 * no teste `npm run test:email-mime`.
 */

const POR_EXTENSAO: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic", heif: "image/heif",
  bmp: "image/bmp",
  tif: "image/tiff", tiff: "image/tiff",
  svg: "image/svg+xml",
  txt: "text/plain", csv: "text/csv",
  xml: "application/xml", json: "application/json",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  ics: "text/calendar",
  eml: "message/rfc822",
};

const GENERICOS = new Set(["", "application/octet-stream", "binary/octet-stream", "application/unknown"]);

/** Extensão em minúsculas, sem ponto ("Nota Fiscal.PDF" → "pdf"). */
export function fileExtension(filename: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(filename.trim());
  return m ? m[1].toLowerCase() : "";
}

/**
 * Tipo final do anexo: respeita o que o navegador informou, e só deduz da
 * extensão quando o informado é genérico (ou não veio).
 */
export function guessContentType(filename: string, declared?: string | null): string {
  const informado = (declared ?? "").trim().toLowerCase();
  if (!GENERICOS.has(informado)) return informado;
  return POR_EXTENSAO[fileExtension(filename)] ?? "application/octet-stream";
}
