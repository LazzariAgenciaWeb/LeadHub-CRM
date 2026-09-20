/**
 * Teste da varredura de ameaça (links e anexos) — `npm run test:email-scan`.
 *
 * O valor aqui não está em pegar golpe (isso é fácil), e sim em NÃO acusar
 * email legítimo: newsletter via rastreador de ESP, subdomínio da própria
 * marca, link de WhatsApp na assinatura. Falso positivo custa caro — o
 * usuário para de confiar no aviso. Ao mexer em email-threat-scan.ts, rode
 * isto antes e depois.
 */
import { analyzeLinks, analyzeAttachment, scanEmailThreats } from "@/lib/email-threat-scan";

const casos: [string, string, string | null, "high" | "warn" | "ok"][] = [
  ["golpe: texto banco, destino outro", `<a href="http://pagamento-seguro.xyz/boleto">www.itau.com.br</a>`, "setorfinanceiro@servidory01l46.picaq.org", "high"],
  ["golpe: truque do @", `<a href="http://itau.com.br@evil.xyz/login">Acessar conta</a>`, "x@y.org", "high"],
  ["golpe: IP cru", `<a href="http://45.33.2.1/nota-fiscal">Baixar NF-e</a>`, "x@y.org", "high"],
  ["golpe: baixa executável", `<a href="https://cdn.tal.xyz/nfe-2026.exe">Nota fiscal</a>`, "x@y.org", "high"],
  ["LEGÍTIMO: subdomínio da marca", `<a href="https://painel.locaweb.com.br/x">www.locaweb.com.br</a>`, "fatura@locaweb.com.br", "ok"],
  ["LEGÍTIMO: texto sem domínio", `<a href="https://app.hostmach.com.br/chamado/1447841">Ver chamado</a>`, "suporte@hostmach.com.br", "ok"],
  ["LEGÍTIMO: newsletter via ESP", `<a href="https://ctrk.klclick.com/abc123">nubank.com.br</a>`, "todomundo@nubank.com.br", "warn"],
  ["LEGÍTIMO: rodapé descadastrar", `<a href="https://list-manage.com/unsubscribe?u=1">Descadastrar</a>`, "news@e-up.tech", "ok"],
  ["LEGÍTIMO: whatsapp na assinatura", `<a href="https://wa.me/5544999999999">(44) 99999-9999</a>`, "diego@azzagencia.com.br", "ok"],
  ["ATENÇÃO: encurtador", `<a href="https://bit.ly/3xyzabc">Ver fatura</a>`, "fin@fornecedor.com.br", "warn"],
  ["ATENÇÃO: boleto fora do domínio", `<a href="https://outro-site.com.br/pagar-boleto">Pagar boleto</a>`, "fin@fornecedor.com.br", "warn"],
];

let falhas = 0;
for (const [nome, html, from, esperado] of casos) {
  const [l] = analyzeLinks(html, from);
  const ok = l?.risk === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "✓" : "✗"} ${nome}\n   risco=${l?.risk} esperado=${esperado}${l?.reasons.length ? ` :: ${l.reasons[0]}` : ""}`);
}

console.log("\n— ANEXOS —");
const anexos: [string, string, "high" | "warn" | "ok"][] = [
  ["boleto.pdf.exe", "application/octet-stream", "high"],
  ["nota-fiscal.exe", "application/octet-stream", "high"],
  ["Contrato.docm", "application/vnd.ms-word.document.macroEnabled.12", "high"],
  ["fatura.pdf", "application/pdf", "ok"],
  ["planilha.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "ok"],
  ["comprovante.jpg", "image/jpeg", "ok"],
  ["segunda-via.html", "text/html", "warn"],
  ["documentos.zip", "application/zip", "ok"],
];
for (const [filename, contentType, esperado] of anexos) {
  const r = analyzeAttachment({ filename, contentType });
  const ok = r.risk === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "✓" : "✗"} ${filename} → ${r.risk} (esperado ${esperado})${r.reasons[0] ? ` :: ${r.reasons[0]}` : ""}`);
}

console.log("\n— EMAIL COMPLETO (golpe do alvará) —");
console.log(scanEmailThreats({
  html: `<p>Prezados, regularize o alvará até 14/08.</p>
         <a href="http://consulta-alvara-palotina.xyz/2via">www.palotina.pr.gov.br</a>`,
  fromEmail: "setorfinanceiro@servidory01l46.picaq.org",
  attachments: [{ filename: "notificacao.pdf.exe", contentType: "application/octet-stream" }],
}));

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ todos os casos passaram");
if (falhas) process.exit(1);
