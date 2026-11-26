/**
 * Central do Cliente — critério de pronto, de ponta a ponta, no banco local:
 *   lead → proposta → contrato enviado → aceite por e-mail (link) →
 *   Kelly confirma faturamento → projeto liberado.
 * Confere que tudo aparece na linha do tempo e pelas ferramentas do Claude,
 * e que as travas funcionam (aceite sem prova, produção sem aceite/faturamento).
 *
 * Cria uma agência de teste isolada e apaga tudo no fim.
 * Rodar: npm run test:client-central
 */
import { prisma } from "@/lib/prisma";
import { upsertSaleFromWonLead } from "@/lib/sales";
import { BillingLinkError, invoiceCandidates, linkInvoicesToSale, undoSaleBilling } from "@/lib/sale-billing";
import { productionBlocker, recordAcceptance, markContractSent, ContractError, validateAcceptance, saleDetalhamento, mergeDetalhamento } from "@/lib/sale-contract";
import { resolveClientForEmail, linkPastEmailsForClient, clientForAddresses } from "@/lib/client-email-link";
import { buildClientTimeline } from "@/lib/client-central";
import { getTool, type ToolContext } from "@/lib/assistant-tools/registry";

let falhas = 0;
function ok(nome: string, cond: boolean, extra = "") {
  if (!cond) falhas++;
  console.log(`${cond ? "✓" : "✗"} ${nome}${extra && !cond ? ` — ${extra}` : ""}`);
}

async function tool(name: string, input: unknown, ctx: ToolContext) {
  const t = getTool(name);
  if (!t) throw new Error(`ferramenta ${name} não registrada`);
  return t.run(input as any, ctx);
}

async function main() {
  const tag = `teste-central-${Date.now()}`;
  const agency = await prisma.company.create({ data: { name: "Agência Teste Central", slug: tag, email: "contato@agenciateste.com.br" } });
  const client = await prisma.company.create({
    data: { name: "Cliente Teste Central", slug: `${tag}-cli`, parentCompanyId: agency.id, website: "https://www.clienteteste.com.br" },
  });
  const other = await prisma.company.create({
    data: { name: "Outro Cliente", slug: `${tag}-outro`, parentCompanyId: agency.id, email: "fulano@gmail.com" },
  });
  const setor = await prisma.setor.create({ data: { name: "Produção", companyId: agency.id } });
  const user = await prisma.user.create({
    data: { name: "Diego Teste", email: `${tag}@teste.local`, password: "x", role: "ADMIN", companyId: agency.id },
  });
  const ctx: ToolContext = {
    userId: user.id, userName: user.name, companyId: agency.id, role: "ADMIN", isAdmin: true, channel: "MCP", now: new Date(),
  };

  try {
    // 1. Lead ganho → venda → vinculada ao cliente
    const lead = await prisma.lead.create({
      data: { companyId: agency.id, phone: "5511999990000", name: "Cliente Teste Central", email: "joao@clienteteste.com.br", value: 4500 },
    });
    await prisma.leadComment.create({ data: { leadId: lead.id, body: "Pediu proposta de site + gestão de redes", authorName: "Diego" } });
    await upsertSaleFromWonLead({ id: lead.id, companyId: agency.id, name: lead.name, phone: lead.phone, value: 4500, clickupTaskId: null, wonAt: new Date() }, { name: "Diego" });
    const sale = await prisma.sale.update({ where: { leadId: lead.id }, data: { clientCompanyId: client.id } });
    ok("venda criada a partir do lead e ligada ao cliente", !!sale && sale.clientCompanyId === client.id);

    // Faturar na esteira com cobrança que JÁ existe no cliente: vincula, não duplica.
    const venc = new Date("2026-09-10T12:00:00Z");
    const [igual, outra] = await Promise.all([
      prisma.clientInvoice.create({ data: { clientCompanyId: client.id, description: "Site (lançada à mão)", amountCents: sale.valueCents, dueDate: venc, status: "PAGO", paidAt: venc, provider: "manual" } }),
      prisma.clientInvoice.create({ data: { clientCompanyId: client.id, description: "Outra coisa", amountCents: 12345, dueDate: venc, status: "ABERTO", provider: "manual" } }),
    ]);
    const cand = await invoiceCandidates(sale);
    ok("candidatas: cobranças soltas do cliente, mesmo valor primeiro", cand.length === 2 && cand[0].id === igual.id && cand[0].mesmoValor && !cand[1].mesmoValor);
    const deOutro = await linkInvoicesToSale(sale, agency.id, [igual.id], null).then(() => false).catch((e) => e instanceof BillingLinkError);
    ok("vincular recusa cobrança que não é do cliente informado", deOutro);
    await linkInvoicesToSale(sale, client.id, [igual.id], null);
    ok("cobrança existente fica ligada à venda, sem criar outra", (await prisma.clientInvoice.count({ where: { saleId: sale.id } })) === 1 && (await prisma.clientInvoice.count({ where: { clientCompanyId: client.id } })) === 2);
    ok("cobrança já vinculada sai das candidatas", (await invoiceCandidates(sale)).every((c) => c.id !== igual.id));
    const dupla = await linkInvoicesToSale(sale, client.id, [igual.id], null).then(() => false).catch((e) => e instanceof BillingLinkError);
    ok("vincular de novo a mesma cobrança é recusado", dupla);
    const criada = await prisma.clientInvoice.create({ data: { clientCompanyId: client.id, saleId: sale.id, description: "Gerada pela esteira", amountCents: 100, dueDate: venc, status: "ABERTO", provider: "manual" } });
    const desf = await undoSaleBilling(sale.id);
    ok("desfazer: solta a vinculada (continua no cliente) e apaga só a gerada em aberto",
      desf.soltas === 1 && desf.removidas === 1 &&
      (await prisma.clientInvoice.findUnique({ where: { id: igual.id } }))?.saleId === null &&
      (await prisma.clientInvoice.findUnique({ where: { id: criada.id } })) === null);
    await prisma.clientInvoice.deleteMany({ where: { id: { in: [igual.id, outra.id] } } });

    // 2. Proposta (documento) pela ferramenta
    const prop = await tool("anexar_documento", {
      clientCompanyId: client.id, tipo: "PROPOSTA", link: "https://drive.google.com/proposta-teste", titulo: "Proposta site + redes", contratoId: sale.id,
    }, ctx);
    ok("anexar_documento (proposta)", prop.ok, prop.ok ? "" : prop.error);

    // 3. Contrato enviado
    const env = await tool("registrar_envio_contrato", { contratoId: sale.id, tipoDocumento: "CONTRATO" }, ctx);
    ok("registrar_envio_contrato", env.ok, env.ok ? "" : env.error);

    // Travas
    const semProva = await recordAcceptance(sale.id, { acceptanceType: "EMAIL" }, agency.id, { name: "t" }).then(() => false).catch((e) => e instanceof ContractError);
    ok("aceite sem link/quem aceitou é recusado", semProva);
    ok("aceite por WhatsApp vale sem link, com quem aceitou", validateAcceptance({ acceptanceType: "WHATSAPP", acceptedByName: "Maria" }) === null);
    ok("aceite por WhatsApp ainda exige quem aceitou", validateAcceptance({ acceptanceType: "WHATSAPP" }) !== null);
    ok("produção liberada quando o contrato não se aplica", productionBlocker({ contractStatus: "DISPENSADO", acceptedAt: null, billingStatus: "PENDENTE", billingConfirmed: true }) === null);

    // Detalhamento gerado da venda: checklist por serviço, sem duplicar nem apagar.
    const escopo = {
      title: "Site + Redes", valueCents: 390000, billingInstructions: "50% na entrada", notes: null, responsibleName: "Ana",
      soldServices: [{ name: "Criação de Sites", recurring: false }, { name: "Gestão de Redes", level: "Plus", recurring: true }],
    };
    const det = saleDetalhamento(escopo);
    ok("detalhamento: um item de checklist por serviço", det.split("\n").filter((l) => l.startsWith("- [ ] ")).length === 2 && det.includes("- [ ] Gestão de Redes (Plus) · recorrente"));
    ok("detalhamento: cobrança combinada e responsável", det.includes("### Cobrança combinada\n50% na entrada") && det.includes("Responsável: Ana"));
    ok("detalhamento: venda sem serviços vira um item com o título", saleDetalhamento({ ...escopo, soldServices: null }).includes("- [ ] Site + Redes"));
    const junto = mergeDetalhamento("Escopo escrito pela equipe", escopo);
    ok("detalhamento: acrescenta sem apagar o que existe", junto.startsWith("Escopo escrito pela equipe") && junto.includes("## Venda: Site + Redes"));
    ok("detalhamento: vincular de novo não duplica", mergeDetalhamento(junto, escopo) === junto);

    const s1 = (await prisma.sale.findUnique({ where: { id: sale.id } }))!;
    ok("produção travada antes do aceite", !!productionBlocker(s1));
    const cedo = await tool("liberar_producao", { contratoId: sale.id, nomeProjeto: "Site Cliente Teste" }, ctx);
    ok("liberar_producao recusa sem aceite/faturamento", !cedo.ok);

    // 4. E-mail de "de acordo" chega do domínio do cliente → liga sozinho
    const auto = await resolveClientForEmail(agency.id, { addresses: ["maria@clienteteste.com.br"] });
    ok("e-mail do domínio do cliente liga automaticamente", auto === client.id, String(auto));
    ok("provedor público não liga por domínio", (await clientForAddresses(agency.id, ["qualquer@gmail.com"])) === null);
    ok("endereço exato de outro cliente liga ao outro", (await clientForAddresses(agency.id, ["fulano@gmail.com"])) === other.id);
    const email = await prisma.inboxEmail.create({
      data: {
        companyId: agency.id, direction: "IN", fromEmail: "maria@clienteteste.com.br", fromName: "Maria (Cliente)",
        toEmail: "contato@agenciateste.com.br", subject: "Re: Contrato — de acordo", snippet: "De acordo com o contrato.",
        sentAt: new Date(Date.now() - 3600_000), clientCompanyId: auto, clientLinkSource: auto ? "AUTO" : null,
      },
    });
    const antigo = await prisma.inboxEmail.create({
      data: { companyId: agency.id, direction: "IN", fromEmail: "joao@clienteteste.com.br", toEmail: "x@y.com", subject: "Briefing antigo", sentAt: new Date(Date.now() - 30 * 86400_000) },
    });
    const ligados = await linkPastEmailsForClient(agency.id, client.id);
    ok("e-mails antigos ligados pelo backfill", ligados >= 1 && !!(await prisma.inboxEmail.findFirst({ where: { id: antigo.id, clientCompanyId: client.id } })));

    const listar = await tool("listar_emails", { clientCompanyId: client.id }, ctx);
    ok("listar_emails filtra por cliente", listar.ok && listar.message.includes("de acordo"), listar.ok ? listar.message.slice(0, 200) : listar.error);

    // 5. Marca o e-mail como aceite (vincular_email_cliente)
    const aceite = await tool("vincular_email_cliente", { emailId: email.id, clientCompanyId: client.id, marcarComo: "ACEITE" }, ctx);
    ok("vincular_email_cliente marca aceite", aceite.ok, aceite.ok ? "" : aceite.error);
    const s2 = (await prisma.sale.findUnique({ where: { id: sale.id } }))!;
    ok("contrato ficou Aceito com prova do e-mail", s2.contractStatus === "ASSINADO" && s2.acceptanceType === "EMAIL" && s2.acceptanceUrl === `/emails?email=${email.id}` && s2.acceptedByEmail === "maria@clienteteste.com.br");
    ok("ainda travado sem faturamento confirmado", productionBlocker(s2)?.includes("faturamento") === true);

    // 6. Kelly confirma o faturamento
    const fat = await tool("confirmar_faturamento", {
      contratoId: sale.id, confirmadoPor: "Kelly", linkConfirmacao: "https://mail.example/kelly-ok",
      instrucoesCobranca: "Entrada de R$ 1.500 no PIX + 2x boleto dia 10",
    }, ctx);
    ok("confirmar_faturamento", fat.ok && fat.message.includes("já pode ser liberada"), fat.ok ? fat.message : fat.error);

    // 7. Serviços vendidos + liberação
    await prisma.sale.update({ where: { id: sale.id }, data: { soldServices: [{ name: "Site institucional", recurring: false, durationMonths: 2 }] } });
    const lib = await tool("liberar_producao", { contratoId: sale.id, nomeProjeto: "Site Cliente Teste" }, ctx);
    ok("liberar_producao com aceite + faturamento", lib.ok, lib.ok ? "" : lib.error);
    const s3 = await prisma.sale.findUnique({ where: { id: sale.id }, include: { project: true } });
    ok("projeto criado com serviços vendidos no detalhamento", !!s3?.project && s3.project.clientCompanyId === client.id && (s3.project.description ?? "").includes("Site institucional"));

    // Enviar de novo não desfaz o aceite
    await markContractSent(sale.id, {}, agency.id, { name: "t" });
    ok("reenvio não 'desaceita' o contrato", (await prisma.sale.findUnique({ where: { id: sale.id } }))!.contractStatus === "ASSINADO");

    // 8. Linha do tempo e resumo
    const tl = await buildClientTimeline(client.id, agency.id, { viewerUserId: user.id });
    const has = (t: string, frag: string) => tl.some((e) => e.type === t && e.title.includes(frag));
    ok("timeline: lead criado", has("LEAD", "Lead criado"));
    ok("timeline: proposta enviada", has("PROPOSTA", "Proposta enviada"));
    ok("timeline: venda ganha", has("VENDA", "Venda ganha"));
    ok("timeline: contrato enviado", has("CONTRATO", "enviado"));
    ok("timeline: contrato aceito (com link)", tl.some((e) => e.type === "CONTRATO" && e.title.includes("aceito") && !!e.link));
    ok("timeline: faturamento confirmado por Kelly", tl.some((e) => e.type === "FATURAMENTO" && e.by === "Kelly"));
    ok("timeline: produção liberada / projeto criado", has("PROJETO", "Produção liberada") && has("PROJETO", "Projeto criado"));
    ok("timeline: e-mail de aceite", has("EMAIL", "(aceite)"));
    ok("timeline em ordem decrescente", tl.every((e, i) => i === 0 || tl[i - 1].at >= e.at));
    const soContrato = await buildClientTimeline(client.id, agency.id, { types: ["CONTRATO"] });
    ok("timeline filtra por tipo", soContrato.length > 0 && soContrato.every((e) => e.type === "CONTRATO"));

    const ltc = await tool("linha_do_tempo_cliente", { clientCompanyId: client.id, tipos: ["CONTRATO", "FATURAMENTO"] }, ctx);
    ok("linha_do_tempo_cliente", ltc.ok && ltc.message.includes("Contrato aceito") && ltc.message.includes("Faturamento confirmado"), ltc.ok ? "" : ltc.error);

    await prisma.company.update({ where: { id: client.id }, data: { driveFolderUrl: "https://drive.google.com/pasta-cliente", clickupListUrl: "https://app.clickup.com/lista-cliente" } });
    const res = await tool("resumo_cliente", { clientCompanyId: client.id }, ctx);
    const m = res.ok ? res.message : "";
    ok("resumo_cliente: aceite", m.includes("aceito em") && m.includes("E-mail"), m);
    ok("resumo_cliente: faturamento confirmado", m.includes("faturamento confirmado por Kelly"));
    ok("resumo_cliente: origem (lead)", m.includes(`id=${lead.id}`));
    ok("resumo_cliente: links Drive/ClickUp", m.includes("drive.google.com/pasta-cliente") && m.includes("clickup.com/lista-cliente"));
    ok("resumo_cliente: 5 últimos eventos", (m.split("Últimos eventos:")[1] ?? "").split("\n").filter((l) => l.startsWith("  - ")).length === 5);
    if (process.env.VERBOSE) console.log("\n" + m + "\n");
  } finally {
    // Limpeza: tudo que é da agência de teste.
    await prisma.sale.deleteMany({ where: { companyId: agency.id } });
    await prisma.financeLog.deleteMany({ where: { companyId: agency.id } });
    await prisma.inboxEmail.deleteMany({ where: { companyId: agency.id } });
    await prisma.clientDocument.deleteMany({ where: { companyId: agency.id } });
    await prisma.setorClickupList.deleteMany({ where: { setorId: setor.id } });
    await prisma.lead.deleteMany({ where: { companyId: agency.id } });
    await prisma.user.deleteMany({ where: { companyId: agency.id } });
    await prisma.setor.deleteMany({ where: { companyId: agency.id } });
    await prisma.company.deleteMany({ where: { parentCompanyId: agency.id } });
    await prisma.company.delete({ where: { id: agency.id } });
    await prisma.$disconnect();
  }

  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
