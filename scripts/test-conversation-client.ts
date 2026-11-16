/**
 * Cliente da conversa do WhatsApp (src/lib/conversation-client.ts):
 *   - parte pura: casamento por nome e desempate da sugestão;
 *   - no banco local: cache de nome na agência NÃO vira cliente, sugestão
 *     certa, ligar cadastra o contato no cliente, troca de cliente, lote em
 *     simulação não grava, linha do tempo do cliente mostra a conversa.
 *
 * Cria uma agência de teste isolada e apaga tudo no fim.
 * Rodar: npm run test:conversation-client
 */
import { prisma } from "@/lib/prisma";
import {
  agencyStopwords, nameMatch, pickSuggestion, loadAgencyContext, suggestClientsForConversations,
  linkConversationToClient, planConversationClientFix, applyConversationClientFix, knownNames,
  type ClientRef,
} from "@/lib/conversation-client";
import { enrichConversations } from "@/lib/conversation-enrich";
import { buildClientTimeline } from "@/lib/client-central";

let falhas = 0;
function ok(nome: string, cond: boolean, extra: unknown = "") {
  if (!cond) falhas++;
  console.log(`${cond ? "✓" : "✗"} ${nome}${!cond && extra !== "" ? ` — ${JSON.stringify(extra)}` : ""}`);
}

function puros() {
  console.log("\n— parte pura —");
  const stop = agencyStopwords({ name: "AZZ Agencia de Marketing Digital", tradeName: "AZZ Agência" });
  const bush: ClientRef = { id: "b", name: "Bushatsky Advogados Associados LTDA", tradeName: "Bushatsky" };
  const nobre: ClientRef = { id: "n", name: "Nobre Corretora de Seguros" };
  const mania: ClientRef = { id: "m", name: "Mania de Móveis Comércio LTDA", tradeName: "Mania de Móveis" };
  const agro: ClientRef = { id: "a", name: "Agrofértil Insumos Agrícolas" };
  const azz: ClientRef = { id: "z", name: "AZZ Software" };

  ok("grupo 'Bushatsky + AZZ Agência' casa Bushatsky (nome completo)", nameMatch("Bushatsky + AZZ Agência", bush, stop) === "NOME");
  ok("grupo 'Nobre Corretora | AZZ' casa Nobre (parcial)", nameMatch("Nobre Corretora | AZZ", nobre, stop) !== null);
  ok("grupo 'Mania de Móveis + AZZ' casa Mania de Móveis", nameMatch("Mania de Móveis + AZZ", mania, stop) === "NOME");
  ok("contato 'Financeiro Agrofértil' casa Agrofértil (acento ignorado)", nameMatch("Financeiro Agrofertil", agro, stop) !== null);
  ok("nome da agência não casa cliente que só divide 'AZZ'", nameMatch("Bushatsky + AZZ Agência", azz, stop) === null);
  ok("nome sem nada a ver não casa", nameMatch("Família Silva", bush, stop) === null);

  const clients = new Map([bush, nobre, mania, agro].map((c) => [c.id, c]));
  const s1 = pickSuggestion([{ clientId: "b", reason: "NOME" }], clients);
  ok("sugestão única pelo nome", s1?.clientId === "b" && s1.clientName === "Bushatsky", s1);
  ok("empate de nome entre dois clientes = sem sugestão",
    pickSuggestion([{ clientId: "b", reason: "NOME" }, { clientId: "n", reason: "NOME" }], clients) === null);
  const s2 = pickSuggestion([{ clientId: "b", reason: "NOME" }, { clientId: "n", reason: "CHAMADO" }], clients);
  ok("chamado ganha de nome", s2?.clientId === "n", s2);
  const s3 = pickSuggestion([{ clientId: "b", reason: "CONTATO" }, { clientId: "n", reason: "VENDA" }], clients);
  ok("contato cadastrado ganha de venda", s3?.clientId === "b", s3);
  ok("cliente fora da carteira é ignorado", pickSuggestion([{ clientId: "x", reason: "CONTATO" }], clients) === null);
}

async function banco() {
  console.log("\n— banco local —");
  const tag = `tcc${Date.now()}`;
  const agency = await prisma.company.create({ data: { name: "AZZ Agencia de Marketing Digital", slug: `${tag}-azz` } });
  const bush = await prisma.company.create({ data: { name: "Bushatsky Advogados", slug: `${tag}-b`, parentCompanyId: agency.id } });
  const agro = await prisma.company.create({ data: { name: "Agrofértil Insumos", slug: `${tag}-a`, parentCompanyId: agency.id, phone: "(41) 9989-1796" } });
  const outro = await prisma.company.create({ data: { name: "Mania de Móveis", slug: `${tag}-m`, parentCompanyId: agency.id } });

  try {
    const groupJid = `1203630${Date.now()}@g.us`;
    const agroPhone = "554199891796"; // sem o 9º dígito; cadastro tem (41) 9989-1796
    const nobrePhone = "5511988887777";
    const gConv = await prisma.conversation.create({ data: { companyId: agency.id, phone: groupJid, isGroup: true, lastMessageAt: new Date(), lastMessageBody: "pode mandar aqui" } });
    const aConv = await prisma.conversation.create({ data: { companyId: agency.id, phone: agroPhone, lastMessageAt: new Date(), lastMessageBody: "vencimento desse mês" } });
    const nConv = await prisma.conversation.create({ data: { companyId: agency.id, phone: nobrePhone, lastMessageAt: new Date() } });
    // Cache de nome do webhook — na PRÓPRIA agência (o bug).
    await prisma.companyContact.createMany({
      data: [
        { companyId: agency.id, phone: groupJid, name: "Bushatsky + AZZ Agência", isGroup: true },
        { companyId: agency.id, phone: agroPhone, name: "Financeiro Agrofértil" },
        { companyId: agency.id, phone: nobrePhone, name: "Fulano" },
      ],
    });

    const ex = await enrichConversations([gConv, aConv, nConv]);
    ok("cache de nome na agência NÃO vira cliente (cliente indefinido)", ex.get(gConv.id)?.companyContact?.company === null, ex.get(gConv.id)?.companyContact);
    ok("…mas o nome do grupo continua aparecendo", ex.get(gConv.id)?.companyContact?.name === "Bushatsky + AZZ Agência");

    const ctx = (await loadAgencyContext(agency.id))!;
    const names = await knownNames(agency.id, [gConv, aConv, nConv]);
    const sug = await suggestClientsForConversations(ctx, [
      { id: gConv.id, phone: groupJid, isGroup: true, name: names.get(gConv.id) ?? null },
      { id: aConv.id, phone: agroPhone, isGroup: false, name: names.get(aConv.id) ?? null },
      { id: nConv.id, phone: nobrePhone, isGroup: false, name: names.get(nConv.id) ?? null },
    ]);
    ok("grupo sugere Bushatsky pelo nome", sug.get(gConv.id)?.suggestion?.clientId === bush.id, sug.get(gConv.id));
    const sa = sug.get(aConv.id)?.suggestion;
    ok("contato sugere Agrofértil (telefone do cadastro + nome)", sa?.clientId === agro.id && sa.reasons.includes("TELEFONE_CLIENTE"), sa);
    ok("contato sem pista fica sem sugestão", sug.get(nConv.id)?.suggestion === null, sug.get(nConv.id));

    // Simulação do lote não grava nada.
    const before = await prisma.companyContact.count({ where: { company: { parentCompanyId: agency.id } } });
    const plan = await planConversationClientFix(agency.id);
    const after = await prisma.companyContact.count({ where: { company: { parentCompanyId: agency.id } } });
    ok("simulação não grava", before === after && before === 0, { before, after });
    ok("grupo pelo nome completo ('Advogados' é ramo, não nome) entra sem ⚠", plan.rows.find((r) => r.phone === groupJid)?.weak === false, plan.rows);
    ok("plano: 2 ligar, 1 indefinido",
      plan.rows.filter((r) => r.action === "LIGAR").length === 2 && plan.rows.filter((r) => r.action === "INDEFINIDO").length === 1, plan.rows);

    // Aplicar.
    const res = await applyConversationClientFix(agency.id, plan.rows);
    ok("aplicar liga 2", res.linked === 2, res);
    const ex2 = await enrichConversations([gConv, aConv]);
    ok("grupo agora mostra Bushatsky", ex2.get(gConv.id)?.companyContact?.company?.id === bush.id, ex2.get(gConv.id));
    ok("contato agora mostra Agrofértil", ex2.get(aConv.id)?.companyContact?.company?.id === agro.id, ex2.get(aConv.id));
    const novo = await prisma.companyContact.findUnique({ where: { companyId_phone: { companyId: bush.id, phone: groupJid } } });
    ok("grupo cadastrado no cliente com o nome do grupo", novo?.isGroup === true && novo.name === "Bushatsky + AZZ Agência", novo);

    // Idempotente.
    const plan2 = await planConversationClientFix(agency.id);
    ok("rodar de novo não liga nada", plan2.rows.filter((r) => r.action === "LIGAR").length === 0 && plan2.alreadyLinked === 2, plan2);

    // Troca manual de cliente: sai de um, entra no outro.
    await linkConversationToClient(agency.id, { phone: groupJid, isGroup: true }, outro.id);
    const onde = await prisma.companyContact.findMany({ where: { phone: groupJid }, select: { companyId: true } });
    ok("trocar cliente move o grupo (e mantém o cache da agência)",
      onde.some((o) => o.companyId === outro.id) && !onde.some((o) => o.companyId === bush.id) && onde.some((o) => o.companyId === agency.id), onde);

    // Não aceita a própria agência / empresa de fora.
    let recusou = false;
    try { await linkConversationToClient(agency.id, { phone: groupJid, isGroup: true }, agency.id); } catch { recusou = true; }
    ok("não liga à própria agência", recusou);

    // Linha do tempo do cliente mostra a conversa (telefone com variação).
    const tl = await buildClientTimeline(agro.id, agency.id, { types: ["WHATSAPP"] });
    ok("linha do tempo do cliente mostra a conversa do WhatsApp", tl.some((e) => e.type === "WHATSAPP" && e.link?.includes(agroPhone)), tl);
  } finally {
    await prisma.conversation.deleteMany({ where: { companyId: agency.id } });
    await prisma.companyContact.deleteMany({ where: { OR: [{ companyId: agency.id }, { company: { parentCompanyId: agency.id } }] } });
    await prisma.company.deleteMany({ where: { parentCompanyId: agency.id } });
    await prisma.company.delete({ where: { id: agency.id } });
  }
}

async function main() {
  puros();
  await banco();
  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exitCode = falhas ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
