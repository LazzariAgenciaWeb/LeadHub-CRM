/**
 * Teste da limpeza do HTML da assinatura — `npm run test:html-sanitize`.
 *
 * Dois lados: não deixar passar script/handler (a assinatura é renderizada
 * no nosso editor e vai embutida no email) e NÃO estragar a assinatura
 * legítima — imagem, link e formatação têm que sobreviver intactos.
 */
import { sanitizeSignatureHtml, looksLikeHtml, htmlToPlainText } from "@/lib/html-sanitize";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe = "") {
  if (!ok) falhas++;
  console.log(`${ok ? "✓" : "✗"} ${nome}${detalhe ? ` :: ${detalhe}` : ""}`);
}

const assinatura = `<p><b>Diego R. Lazzari</b><br/>AZZ Agência de Marketing Digital<br/>
<a href="https://azzagencia.com.br">azzagencia.com.br</a> · (44) 99999-9999</p>
<img src="https://azzagencia.com.br/logo.png" alt="AZZ" style="max-width:220px" />`;

const limpa = sanitizeSignatureHtml(assinatura);
check("assinatura legítima passa inteira", limpa.includes("<img") && limpa.includes("azzagencia.com.br") && limpa.includes("<b>"));
check("estilo inline preservado", limpa.includes("max-width:220px"));

check("script é removido", !sanitizeSignatureHtml('<p>oi</p><script>alert(1)</script>').toLowerCase().includes("script"));
check("iframe é removido", !sanitizeSignatureHtml('<iframe src="http://x"></iframe>oi').toLowerCase().includes("iframe"));
check("handler inline some", !sanitizeSignatureHtml('<img src="x.png" onerror="alert(1)">').toLowerCase().includes("onerror"));
check("link javascript: é neutralizado", !sanitizeSignatureHtml('<a href="javascript:alert(1)">clique</a>').toLowerCase().includes("javascript:"));
check("texto do link continua lá", sanitizeSignatureHtml('<a href="javascript:alert(1)">clique</a>').includes("clique"));

check("texto puro não é confundido com HTML", looksLikeHtml("Diego R. Lazzari\nAZZ") === false);
check("HTML é reconhecido", looksLikeHtml("<p>oi</p>") === true);

const texto = htmlToPlainText(assinatura);
check("versão texto mantém as linhas", texto.includes("Diego R. Lazzari") && texto.includes("azzagencia.com.br") && !texto.includes("<"));

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ todos os casos passaram");
if (falhas) process.exit(1);
