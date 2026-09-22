/**
 * Teste do agrupamento das cópias — `npm run test:email-group`.
 *
 * O risco aqui é email SUMIR da lista ou perder sinal ao colapsar cópias
 * (não lido virar lido, tag/anexo/vínculo desaparecer). Ao mexer em
 * email-group.ts, rode antes e depois.
 */
import { groupEmailCopies, type GroupableEmail } from "@/lib/email-group";

const cx = (id: string, label: string) => ({ id, label, fromEmail: `${label}@azz.com.br` });
const FIN = cx("acc-fin", "Financeiro");
const BOL = cx("acc-bol", "Boletos");

let falhas = 0;
function check(nome: string, ok: boolean, detalhe = "") {
  if (!ok) falhas++;
  console.log(`${ok ? "✓" : "✗"} ${nome}${detalhe ? ` :: ${detalhe}` : ""}`);
}

// 1) mesma mensagem em duas caixas vira UMA linha com as duas etiquetas
const dupes: GroupableEmail[] = [
  { id: "a", messageId: "<x@srv>", seen: true, account: FIN, accountId: FIN.id, tags: [{ id: "t1", name: "Conta a Pagar", color: "#fff" }] },
  { id: "b", messageId: "<x@srv>", seen: false, account: BOL, accountId: BOL.id, tags: [{ id: "t2", name: "Clientes", color: "#fff" }], _count: { attachments: 2 } },
];
const g1 = groupEmailCopies(dupes, 50);
check("duas cópias → uma linha", g1.length === 1, `${g1.length} linha(s)`);
check("etiquetas das duas caixas", g1[0].boxes.length === 2);
check("não lido em qualquer caixa deixa a linha não lida", g1[0].seen === false);
check("tags das duas cópias aparecem", (g1[0].tags ?? []).length === 2);
check("anexo da outra cópia é herdado", g1[0]._count?.attachments === 2);
check("contador de cópias", g1[0].copies === 2);

// 2) não pode mexer no objeto de origem (tags é array compartilhado)
check("não mutou as tags do original", dupes[0].tags!.length === 1, `${dupes[0].tags!.length}`);

// 3) emails diferentes continuam separados
const distintos: GroupableEmail[] = [
  { id: "c", messageId: "<1@srv>", account: FIN },
  { id: "d", messageId: "<2@srv>", account: FIN },
];
check("mensagens diferentes não se fundem", groupEmailCopies(distintos, 50).length === 2);

// 4) sem Message-ID não agrupa (não dá pra afirmar que é o mesmo email)
const semId: GroupableEmail[] = [
  { id: "e", messageId: null, account: FIN },
  { id: "f", messageId: null, account: BOL },
];
check("sem Message-ID cada um é um", groupEmailCopies(semId, 50).length === 2);

// 5) vínculo de lead/chamado de qualquer cópia aparece
const comVinculo: GroupableEmail[] = [
  { id: "g", messageId: "<y@srv>", account: FIN },
  { id: "h", messageId: "<y@srv>", account: BOL, ticketId: "tk1", ticket: { id: "tk1", title: "Chamado" } },
];
check("chamado vindo da segunda cópia", groupEmailCopies(comVinculo, 50)[0].ticket?.id === "tk1");

// 6) o corte respeita o take DEPOIS de agrupar (página não encolhe à toa)
const muitos: GroupableEmail[] = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, messageId: `<${i}@srv>`, account: FIN }));
check("take corta depois de agrupar", groupEmailCopies([...muitos, ...muitos], 10).length === 10);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ todos os casos passaram");
if (falhas) process.exit(1);
