/**
 * Anexo enviado chega inteiro do outro lado?
 *
 * Refaz o caminho exato do app — arquivo → base64 (FileReader no navegador) →
 * Buffer → nodemailer/MailComposer → MIME — e compara byte a byte com o
 * original depois de reabrir o MIME com o mesmo parser que usamos pra ler
 * email recebido. Cliente reclamando de "anexo que não abre" costuma ser
 * corrupção silenciosa no meio desse caminho.
 *
 * Rodar: npm run test:email-mime
 */
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser } from "mailparser";
import { randomBytes } from "crypto";
import { guessContentType } from "../src/lib/email-attachment-type";

let falhas = 0;

function build(mailOpts: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    new MailComposer(mailOpts).compile().build((err: any, msg: Buffer) => (err ? reject(err) : resolve(msg)));
  });
}

async function caso(nome: string, filename: string, contentType: string, bytes: Buffer) {
  // base64 é como o anexo viaja do navegador até a rota de envio.
  const contentBase64 = bytes.toString("base64");
  const tipo = guessContentType(filename, contentType);
  const raw = await build({
    from: "Teste <a@b.com>", to: "c@d.com", subject: "x", text: "y", html: "<p>y</p>",
    attachments: [{ filename, contentType: tipo, content: Buffer.from(contentBase64, "base64") }],
  });
  const parsed = await simpleParser(raw);
  const att = parsed.attachments[0];
  const igual = !!att && Buffer.compare(att.content as Buffer, bytes) === 0;
  const ok = igual && att?.contentType === tipo;
  if (!ok) falhas++;
  console.log(
    `${ok ? "✓" : "✗"} ${nome}: nome="${att?.filename}" tipo=${att?.contentType} ` +
    `${bytes.length}B → ${att?.content?.length ?? 0}B ${igual ? "idênticos" : "DIFERENTES"}`,
  );
}

async function main() {
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001",
    "hex",
  );
  const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(5000), Buffer.from("\n%%EOF")]);

  await caso("PNG com tipo do navegador", "foto.png", "image/png", png);
  await caso("PDF com tipo do navegador", "nota.pdf", "application/pdf", pdf);
  await caso("PDF sem tipo (navegador não informou)", "nota.pdf", "", pdf);
  await caso("PDF que veio como octet-stream", "nota.pdf", "application/octet-stream", pdf);
  await caso("JPG que veio como octet-stream", "foto.JPG", "application/octet-stream", png);
  await caso("Nome com acento e espaço", "Proposta Comercial — Açaí.pdf", "application/pdf", pdf);
  await caso("Anexo de 3MB", "grande.pdf", "application/pdf",
    Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(3 * 1024 * 1024)]));

  // Por que o app passou a conferir o tamanho do anexo na rota de envio:
  const b64 = pdf.toString("base64");
  const cortado = Buffer.from(b64.slice(0, Math.floor(b64.length * 0.8)), "base64");
  const silencioso = cortado.length > 0 && cortado.length < pdf.length;
  if (!silencioso) falhas++;
  console.log(
    `${silencioso ? "✓" : "✗"} base64 cortado no transporte: ${pdf.length}B → ${cortado.length}B ` +
    `(Buffer.from decodifica o pedaço SEM erro — é isso que gera "anexo não abre", ` +
    `por isso a rota compara o tamanho declarado)`,
  );

  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
}

main();
