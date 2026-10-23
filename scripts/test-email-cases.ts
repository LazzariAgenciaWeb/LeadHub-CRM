/**
 * Agrupamento por caso: o que junta, o que NÃO junta.
 * Rodar: npm run test:email-cases
 */
import {
  caseKeyOf, caseTokens, senderDomain, groupEmailCases, CASE_WINDOW_DAYS,
} from "../src/lib/email-cases";

let falhas = 0;
function ok(nome: string, cond: boolean, extra = "") {
  if (!cond) falhas++;
  console.log(`${cond ? "✓" : "✗"} ${nome}${extra && !cond ? ` — ${extra}` : ""}`);
}

const dia = 86_400_000;
const base = new Date("2026-10-20T10:00:00Z").getTime();
const em = (dias: number) => new Date(base - dias * dia);

type Row = { id: string; fromEmail: string; subject: string; sentAt: Date };
const row = (id: string, fromEmail: string, subject: string, dias = 0): Row =>
  ({ id, fromEmail, subject, sentAt: em(dias) });

// ── Peças da chave ──
ok("domínio do remetente", senderDomain("Cobranca@Registro.BR") === "registro.br");
ok("domínio no assunto vira identificador",
  caseTokens("Aviso de vencimento do domínio azzagencia.com.br")[0] === "azzagencia.com.br");
ok("número de boleto vira identificador",
  caseTokens("Fatura 4820391 disponível").includes("4820391"));
ok("número curto não conta", caseTokens("Fatura 123 de outubro").length === 0);
ok("domínio tem prioridade sobre número",
  caseTokens("Fatura 4820391 do domínio azz.com.br")[0] === "azz.com.br");

// ── Chave ──
ok("mesmo domínio + mesmo identificador = mesma chave",
  caseKeyOf(row("a", "cobranca@registro.br", "Fatura do domínio azz.com.br")) ===
  caseKeyOf(row("b", "avisos@registro.br", "Aviso de vencimento: azz.com.br")));
ok("identificador diferente separa",
  caseKeyOf(row("a", "cobranca@registro.br", "Fatura azz.com.br")) !==
  caseKeyOf(row("b", "cobranca@registro.br", "Fatura outrodominio.com.br")));
ok("gmail agrupa por endereço, não por domínio",
  caseKeyOf(row("a", "joao@gmail.com", "Pedido 998877")) !==
  caseKeyOf(row("b", "maria@gmail.com", "Pedido 998877")));
ok("sem remetente não tem caso", caseKeyOf({ id: "x", fromEmail: "", subject: "Fatura" }) === null);
ok("sem identificador cai no assunto",
  caseKeyOf(row("a", "x@y.com.br", "Comunicado importante")) ===
  caseKeyOf(row("b", "x@y.com.br", "Re: Comunicado importante")));

// ── O caso registro.br ──
const registro = groupEmailCases([
  row("fatura", "cobranca@registro.br", "Fatura do domínio azzagencia.com.br", 0),
  row("renov", "avisos@registro.br", "Renovação de azzagencia.com.br concluída", 5),
  row("lembrete", "avisos@registro.br", "Lembrete: azzagencia.com.br vence em 10 dias", 20),
  row("aviso", "hostmaster@registro.br", "Aviso de vencimento — azzagencia.com.br", 40),
  row("outro", "cobranca@registro.br", "Fatura do domínio clientex.com.br", 1),
  row("cliente", "contato@clientex.com.br", "Dúvida sobre o site", 2),
]);
ok("virou 3 linhas (caso + outro domínio + cliente)", registro.length === 3, `veio ${registro.length}`);
ok("a linha é a mensagem mais recente", registro[0].id === "fatura");
ok("o caso tem as 4 mensagens", registro[0].caseCount === 4, `veio ${registro[0].caseCount}`);
ok("caseIds traz todas", registro[0].caseIds.join(",") === "fatura,renov,lembrete,aviso");
ok("domínio diferente ficou de fora", registro[1].id === "outro" && registro[1].caseCount === 1);
ok("email de outro remetente intacto", registro[2].id === "cliente" && registro[2].caseCount === 1);

// ── Janela ──
const velho = groupEmailCases([
  row("agora", "cobranca@registro.br", "Fatura azz.com.br", 0),
  row("ano passado", "cobranca@registro.br", "Fatura azz.com.br", CASE_WINDOW_DAYS + 10),
]);
ok("fora da janela não junta", velho.length === 2, `veio ${velho.length}`);

// ── Não mexe no que é linha solta ──
const soltas = groupEmailCases([
  row("a", "um@x.com", "Assunto A"),
  row("b", "dois@y.com", "Assunto B"),
]);
ok("linhas soltas continuam soltas", soltas.length === 2 && soltas.every((g) => g.caseCount === 1));
ok("linha solta não ganha membro", soltas[0].caseMembers.length === 0);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
