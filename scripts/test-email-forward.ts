/**
 * Corpo do encaminhamento: assunto, cabeçalho, conversa ligada e os tetos.
 * Rodar: npm run test:email-forward
 */
import {
  buildForwardBody, forwardSubject, plainBody,
  MAX_RELATED, MAX_BODY_CHARS, type ForwardMsg,
} from "../src/lib/email-forward";

let falhas = 0;
function ok(nome: string, cond: boolean, extra = "") {
  if (!cond) falhas++;
  console.log(`${cond ? "✓" : "✗"} ${nome}${extra && !cond ? ` — ${extra}` : ""}`);
}

const msg = (over: Partial<ForwardMsg> = {}): ForwardMsg => ({
  direction: "IN",
  fromEmail: "cobranca@registro.br",
  fromName: "Registro.br",
  toEmail: "financeiro@azzagencia.com.br",
  ccEmail: null,
  subject: "Fatura do domínio azzagencia.com.br",
  textBody: "Segue a fatura para pagamento até 30/10.",
  htmlBody: null,
  snippet: "Segue a fatura",
  sentAt: new Date("2026-10-20T09:14:00-03:00"),
  ...over,
});

// ── Assunto ──
ok("assunto ganha Enc:", forwardSubject("Fatura") === "Enc: Fatura");
ok("assunto já encaminhado não duplica", forwardSubject("Enc: Fatura") === "Enc: Fatura");
ok("Fwd: também conta como prefixo", forwardSubject("Fwd: Fatura") === "Fwd: Fatura");
ok("sem assunto", forwardSubject("   ") === "Enc: (sem assunto)");

// ── Corpo em texto puro ──
ok("HTML vira texto",
  plainBody(msg({ textBody: null, htmlBody: "<p>Olá<br/>mundo</p>" })) === "Olá\nmundo");
ok("cai pro trecho quando não tem corpo",
  plainBody(msg({ textBody: "", htmlBody: "", snippet: "só o trecho" })) === "só o trecho");

// ── Mensagem sozinha ──
const simples = buildForwardBody(msg());
ok("marca o bloco encaminhado", simples.includes("---------- Mensagem encaminhada ----------"));
ok("cabeçalho com remetente", simples.includes("De: Registro.br <cobranca@registro.br>"));
ok("cabeçalho com data no fuso BR", simples.includes("Data: 20/10/2026, 09:14"));
ok("corpo do original", simples.includes("Segue a fatura para pagamento até 30/10."));
ok("começa com espaço pra escrever em cima", simples.startsWith("\n\n"));
ok("sem conversa não inventa seção", !simples.includes("Mensagens ligadas"));

// ── Com a conversa ligada (o caso registro.br) ──
const ligadas: ForwardMsg[] = [
  msg({ subject: "Aviso de vencimento", textBody: "Seu domínio vence em 30 dias.", sentAt: new Date("2026-09-20T10:00:00-03:00") }),
  msg({ subject: "Lembrete de renovação", textBody: "Faltam 10 dias.", sentAt: new Date("2026-10-10T10:00:00-03:00") }),
  msg({ direction: "OUT", fromEmail: "financeiro@azzagencia.com.br", fromName: "AZZ", toEmail: "cobranca@registro.br", subject: "Re: Lembrete", textBody: "Vamos pagar hoje.", sentAt: new Date("2026-10-11T08:00:00-03:00") }),
];
const comFio = buildForwardBody(msg(), ligadas);
ok("anuncia quantas mensagens ligadas", comFio.includes("Mensagens ligadas a este assunto (3)"));
ok("traz corpo das ligadas",
  ["Seu domínio vence em 30 dias.", "Faltam 10 dias.", "Vamos pagar hoje."].every((t) => comFio.includes(t)));
ok("marca recebido/enviado", comFio.includes("· recebido ·") && comFio.includes("· enviado ·"));
ok("numera as ligadas", comFio.includes("--- 1/3 ·") && comFio.includes("--- 3/3 ·"));

// ── Tetos ──
const muitas = Array.from({ length: MAX_RELATED + 4 }, (_, i) => msg({ textBody: `mensagem ${i}` }));
const cortado = buildForwardBody(msg(), muitas);
ok(`inclui no máximo ${MAX_RELATED} ligadas`, cortado.includes(`(${MAX_RELATED})`));
ok("avisa quantas ficaram de fora", cortado.includes("[+4 mensagem(ns) mais antiga(s) não incluída(s)]"));

const gigante = buildForwardBody(msg({ textBody: "x".repeat(MAX_BODY_CHARS + 500) }));
ok("corta corpo gigante e avisa", gigante.includes("mensagem cortada aqui"));

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
