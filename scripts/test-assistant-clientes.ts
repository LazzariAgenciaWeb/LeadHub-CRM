/**
 * Ferramentas do assistente/MCP que editam o cadastro do cliente e os serviços
 * contratados: atualizar_cliente, listar_servicos_cliente, atualizar_servico_cliente.
 * Foco na regra que custa dinheiro: data de encerramento em recorrente.
 *
 * Cria uma agência de teste isolada no banco local e apaga tudo no fim.
 * Rodar: npm run test:assistant-clientes
 */
import { prisma } from "@/lib/prisma";
import { getTool, type ToolContext } from "@/lib/assistant-tools/registry";
import { dueInMonth } from "@/app/(admin)/financeiro/lib";

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
  const tag = `teste-asst-cli-${Date.now()}`;
  const agency = await prisma.company.create({ data: { name: "Agência Teste Assistente", slug: tag } });
  const other = await prisma.company.create({ data: { name: "Outra Agência", slug: `${tag}-outra` } });
  const client = await prisma.company.create({ data: { name: "Cliente Teste LTDA", slug: `${tag}-cli`, parentCompanyId: agency.id } });
  const alheio = await prisma.company.create({ data: { name: "Cliente Alheio", slug: `${tag}-alheio`, parentCompanyId: other.id } });
  const cs = await prisma.clientService.create({
    data: {
      clientCompanyId: client.id, label: "Gestão de mídias", status: "ATIVO", provider: "manual",
      amountCents: 150000, isRecurring: true, billingCycle: "MENSAL", billingDay: 10,
      startedAt: new Date("2026-01-05T12:00:00-03:00"),
    },
  });
  const csAlheio = await prisma.clientService.create({ data: { clientCompanyId: alheio.id, label: "Alheio", provider: "manual" } });

  const ctx: ToolContext = { userId: "u-teste", userName: "Teste", companyId: agency.id, role: "ADMIN", isAdmin: true, channel: "MCP", now: new Date("2026-11-25T12:00:00-03:00") };
  const atendente: ToolContext = { ...ctx, role: "CLIENT", isAdmin: false };

  try {
    // ── Cadastro ──────────────────────────────────────────────────────────
    let r = await tool("atualizar_cliente", { clientCompanyId: client.id, tradeName: "Cliente Teste", document: "12.345.678/0001-90", phone: "(41) 99999-0000", billingNotes: "Emitir NF dentro do mês" }, ctx);
    let c = await prisma.company.findUniqueOrThrow({ where: { id: client.id } });
    ok("cadastro: edita fantasia, documento, telefone e instrução de cobrança", r.ok && c.tradeName === "Cliente Teste" && c.document === "12345678000190" && c.phone === "41999990000" && c.billingNotes === "Emitir NF dentro do mês", JSON.stringify(r));
    ok("cadastro: não mexe no que não veio", c.name === "Cliente Teste LTDA");
    r = await tool("atualizar_cliente", { clientCompanyId: client.id, tradeName: "" }, ctx);
    c = await prisma.company.findUniqueOrThrow({ where: { id: client.id } });
    ok("cadastro: string vazia limpa o campo", r.ok && c.tradeName === null);
    ok("cadastro: recusa documento com tamanho errado", !(await tool("atualizar_cliente", { clientCompanyId: client.id, document: "123" }, ctx)).ok);
    ok("cadastro: recusa nome vazio", !(await tool("atualizar_cliente", { clientCompanyId: client.id, name: " " }, ctx)).ok);
    ok("cadastro: recusa cliente de outra agência", !(await tool("atualizar_cliente", { clientCompanyId: alheio.id, segment: "x" }, ctx)).ok);
    ok("cadastro: atendente não edita", !(await tool("atualizar_cliente", { clientCompanyId: client.id, segment: "x" }, atendente)).ok);

    // ── Serviços ──────────────────────────────────────────────────────────
    r = await tool("listar_servicos_cliente", { clientCompanyId: client.id }, ctx);
    ok("lista traz o servicoId", r.ok && r.message.includes(`servicoId=${cs.id}`), JSON.stringify(r));

    r = await tool("atualizar_servico_cliente", { servicoId: cs.id, endedAt: "2026-12-31", motivo: "cliente avisou a saída" }, ctx);
    let s = await prisma.clientService.findUniqueOrThrow({ where: { id: cs.id } });
    ok("encerramento futuro: grava a data e mantém ATIVO", r.ok && s.status === "ATIVO" && s.endedAt?.toISOString() === "2026-12-31T15:00:00.000Z", `${JSON.stringify(r)} ${s.endedAt?.toISOString()}`);
    ok("encerramento futuro: preserva valor e recorrência", s.amountCents === 150000 && s.isRecurring && s.billingDay === 10);
    ok("fila: ainda devido em dez/2026", dueInMonth(s, "2026-12"));
    ok("fila: não devido em jan/2027", !dueInMonth(s, "2027-01"));
    const log = await prisma.financeLog.findFirst({ where: { entityId: cs.id }, orderBy: { createdAt: "desc" } });
    ok("trilha do financeiro registra a alteração e o motivo", log?.action === "ALTERADO" && !!log.description?.includes("cliente avisou"));

    r = await tool("atualizar_servico_cliente", { servicoId: cs.id, amountCents: 180000 }, ctx);
    s = await prisma.clientService.findUniqueOrThrow({ where: { id: cs.id } });
    ok("mudar só o valor não derruba ciclo/dia nem a data de fim", r.ok && s.amountCents === 180000 && s.isRecurring && s.billingCycle === "MENSAL" && s.billingDay === 10 && !!s.endedAt);

    r = await tool("atualizar_servico_cliente", { servicoId: cs.id, endedAt: null }, ctx);
    s = await prisma.clientService.findUniqueOrThrow({ where: { id: cs.id } });
    ok("endedAt null limpa a data", r.ok && s.endedAt === null);

    r = await tool("atualizar_servico_cliente", { servicoId: cs.id, status: "ENCERRADO" }, ctx);
    s = await prisma.clientService.findUniqueOrThrow({ where: { id: cs.id } });
    ok("status ENCERRADO sem data carimba hoje", r.ok && s.status === "ENCERRADO" && !!s.endedAt);
    r = await tool("atualizar_servico_cliente", { servicoId: cs.id, status: "ATIVO" }, ctx);
    s = await prisma.clientService.findUniqueOrThrow({ where: { id: cs.id } });
    ok("reabrir limpa a data", r.ok && s.status === "ATIVO" && s.endedAt === null);

    ok("recusa encerramento antes do início", !(await tool("atualizar_servico_cliente", { servicoId: cs.id, endedAt: "2025-12-31" }, ctx)).ok);
    ok("recusa data inválida", !(await tool("atualizar_servico_cliente", { servicoId: cs.id, endedAt: "fim do ano" }, ctx)).ok);
    ok("recusa serviço de outra agência", !(await tool("atualizar_servico_cliente", { servicoId: csAlheio.id, status: "ENCERRADO" }, ctx)).ok);
    ok("atendente não mexe em serviço", !(await tool("atualizar_servico_cliente", { servicoId: cs.id, status: "ENCERRADO" }, atendente)).ok);
  } finally {
    await prisma.financeLog.deleteMany({ where: { companyId: { in: [agency.id, other.id] } } });
    await prisma.company.deleteMany({ where: { id: { in: [client.id, alheio.id] } } });
    await prisma.company.deleteMany({ where: { id: { in: [agency.id, other.id] } } });
  }

  console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
