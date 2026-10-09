/**
 * Teste da sugestão de destinatário — `npm run test:email-contacts`.
 *
 * O que erra fácil aqui: ler endereço de uma lista com "Nome <email>",
 * repetir o mesmo contato em maiúsculas/minúsculas e ordenar errado (quem
 * você mais escreve tem que vir primeiro).
 */
import { splitAddresses, mergeContacts } from "@/lib/email-contacts";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe = "") {
  if (!ok) falhas++;
  console.log(`${ok ? "✓" : "✗"} ${nome}${detalhe ? ` :: ${detalhe}` : ""}`);
}

// ── leitura dos endereços ──
const lista = splitAddresses('"Kelly | Financeiro" <kelly@pillares.com.br>, cris@escritorio.com.br ; Lixo sem email');
check("lê nome + email e endereço solto", lista.length === 2, JSON.stringify(lista));
check("tira as aspas do nome", lista[0]?.name === "Kelly | Financeiro");
check("email em minúsculo", splitAddresses("DIEGO@AZZ.com.br")[0]?.email === "diego@azz.com.br");
check("texto que não é email é descartado", splitAddresses("sem email aqui").length === 0);
check("campo vazio não quebra", splitAddresses(null).length === 0);

// ── ordem das sugestões ──
const sugestoes = mergeContacts({
  enviados: [
    { toEmail: "cris@escritorio.com.br", ccEmail: null },
    { toEmail: "Cris <CRIS@escritorio.com.br>", ccEmail: "kelly@pillares.com.br" },
  ],
  recebidos: [{ fromEmail: "noreply@hostmach.com.br", fromName: "Hosting Machine" }],
  clientes: [{ name: "Palotina Press", email: "contato@palotinapress.com.br" }],
  leads: [{ name: "Lead Novo", email: "lead@novo.com.br" }],
});

check("quem você mais escreve vem primeiro", sugestoes[0]?.email === "cris@escritorio.com.br", sugestoes[0]?.email);
check("não duplica o mesmo endereço em outra caixa alta", sugestoes.filter((c) => c.email === "cris@escritorio.com.br").length === 1);
check("nome aparece mesmo vindo só na segunda vez", sugestoes.find((c) => c.email === "cris@escritorio.com.br")?.name === "Cris");
check("cliente cadastrado entra na lista", sugestoes.some((c) => c.email === "contato@palotinapress.com.br" && c.source === "cliente"));
check("lead entra na lista", sugestoes.some((c) => c.source === "lead"));
check("remetente automático fica por último", sugestoes[sugestoes.length - 1]?.email === "noreply@hostmach.com.br");

// ── busca ──
const porNome = mergeContacts({
  enviados: [], recebidos: [],
  clientes: [{ name: "Palotina Press", email: "contato@palotinapress.com.br" }],
  leads: [{ name: "Outro", email: "outro@x.com.br" }],
}, "palot");
check("busca pelo nome do cliente", porNome.length === 1 && porNome[0].email === "contato@palotinapress.com.br");

const porEndereco = mergeContacts({
  enviados: [{ toEmail: "a@x.com.br, kelly@pillares.com.br", ccEmail: null }], recebidos: [], clientes: [], leads: [],
}, "kelly");
check("busca olha endereço por endereço do campo", porEndereco.length === 1 && porEndereco[0].email === "kelly@pillares.com.br");

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ todos os casos passaram");
if (falhas) process.exit(1);
