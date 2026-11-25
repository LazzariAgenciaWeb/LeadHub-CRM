import { prisma } from "@/lib/prisma";
import { type ToolDef, ok, fail, appUrl, fmtDate, fmtDateTime, brl } from "./types";
import { ACCEPTANCE_LABEL, CONTRACT_STATUS_LABEL, productionBlocker } from "@/lib/sale-contract";
import { buildClientTimeline, TIMELINE_LABEL } from "@/lib/client-central";
import { clientIdsByDocument, documentDigits, formatDocument, looksLikeDocument } from "@/lib/client-document";

/** Ferramentas de LEITURA: buscar cliente, projetos, usuários, resumo de cliente. */

export const buscarCliente: ToolDef<{ query: string }> = {
  name: "buscar_cliente",
  description:
    "Busca empresas-cliente da carteira pelo nome (parcial, sem acento) OU pelo CNPJ/CPF (com ou sem máscara; a raiz do CNPJ acha matriz e filiais). Use antes de criar chamado/projeto/cobrança pra obter o clientCompanyId. Retorna até 8 resultados com id, nome, CNPJ/CPF, telefone e contatos.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "Trecho do nome do cliente, ou o CNPJ/CPF" } },
    required: ["query"],
  },
  run: async ({ query }, ctx) => {
    const q = (query ?? "").trim();
    if (!q) return fail("Informe um trecho do nome ou o CNPJ/CPF.");
    const byDoc = looksLikeDocument(q);
    const docIds = byDoc ? await clientIdsByDocument(ctx.companyId, q) : [];
    const rows = await prisma.company.findMany({
      where: {
        parentCompanyId: ctx.companyId,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { tradeName: { contains: q, mode: "insensitive" } },
          ...(docIds.length ? [{ id: { in: docIds } }] : []),
        ],
      },
      select: {
        id: true, name: true, tradeName: true, document: true, phone: true, email: true, status: true,
        contacts: { take: 3, select: { name: true, phone: true, role: true } },
      },
      take: 8,
      orderBy: { name: "asc" },
    });
    if (rows.length === 0) {
      return ok(
        byDoc
          ? `Nenhum cliente com o documento ${formatDocument(documentDigits(q))}. Se o cliente existe, o CNPJ/CPF dele pode não estar no cadastro: busque pelo nome e grave o documento com atualizar_cliente.`
          : `Nenhum cliente encontrado para "${q}".`,
        { data: [] },
      );
    }
    const lines = rows.map((c) =>
      `- ${c.name}${c.tradeName ? ` (${c.tradeName})` : ""} · id=${c.id}${c.document ? ` · doc ${formatDocument(c.document)}` : " · sem CNPJ/CPF"}${c.phone ? ` · ${c.phone}` : ""}${c.status !== "ACTIVE" ? " · INATIVO" : ""}` +
      (c.contacts.length ? ` · contatos: ${c.contacts.map((k) => `${k.name ?? "?"} ${k.phone}`).join(", ")}` : "")
    );
    return ok(lines.join("\n"), { data: rows });
  },
};

function resumo(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export const listarProjetos: ToolDef<{ clientCompanyId?: string; query?: string; apenasAtivos?: boolean }> = {
  name: "listar_projetos",
  description:
    "Lista projetos da empresa. Filtre por cliente (clientCompanyId) e/ou trecho do nome. Retorna id, nome, cliente, status, prazo, nº de tarefas abertas e as etapas de cada projeto (id e nome). Inclui o começo do detalhamento (escopo vendido / o que fazer); o texto completo vem de ver_detalhamento_projeto. Use pra descobrir o projetoId antes de criar uma tarefa de projeto; pras etapas com contagem, use listar_etapas_projeto.",
  input_schema: {
    type: "object",
    properties: {
      clientCompanyId: { type: "string" },
      query: { type: "string", description: "Trecho do nome do projeto" },
      apenasAtivos: { type: "boolean", description: "Default true: exclui ENTREGUE/CANCELADO" },
    },
  },
  run: async ({ clientCompanyId, query, apenasAtivos = true }, ctx) => {
    const rows = await prisma.setorClickupList.findMany({
      where: {
        setor: { companyId: ctx.companyId },
        ...(clientCompanyId ? { clientCompanyId } : {}),
        ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
        ...(apenasAtivos ? { status: { notIn: ["ENTREGUE", "CANCELADO"] } } : {}),
      },
      select: {
        id: true, name: true, status: true, dueDate: true, type: true, description: true,
        clientCompany: { select: { id: true, name: true } },
        _count: { select: { internalTasks: { where: { done: false, ignoredAt: null } } } },
        serviceSteps: {
          orderBy: { order: "asc" },
          select: { id: true, name: true, order: true, service: { select: { name: true } } },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 15,
    });
    if (rows.length === 0) return ok("Nenhum projeto encontrado.", { data: [] });
    const lines = rows.map((p) => {
      const etapas = p.serviceSteps.map((e) => `${(e.name || e.service?.name || "Serviço").trim()} (id=${e.id})`);
      return `- ${p.name} · id=${p.id} · ${p.clientCompany?.name ?? "sem cliente"} · ${p.status} · prazo ${fmtDate(p.dueDate)} · ${p._count.internalTasks} tarefa(s) aberta(s)` +
        (etapas.length ? `\n    etapas: ${etapas.join(" · ")}` : "\n    sem etapas") +
        (p.description?.trim() ? `\n    detalhamento: ${resumo(p.description, 160)} (ver_detalhamento_projeto)` : "");
    });
    return ok(lines.join("\n"), { data: rows });
  },
};

export const listarUsuarios: ToolDef<Record<string, never>> = {
  name: "listar_usuarios",
  description: "Lista os usuários (atendentes) da empresa com id e nome, pra usar como assigneeId ao criar chamado ou tarefa.",
  input_schema: { type: "object", properties: {} },
  run: async (_i, ctx) => {
    const rows = await prisma.user.findMany({
      where: { companyId: ctx.companyId, role: { not: "SUPER_ADMIN" } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });
    return ok(rows.map((u) => `- ${u.name} · id=${u.id}`).join("\n") || "Nenhum usuário.", { data: rows });
  },
};

export const listarSetores: ToolDef<Record<string, never>> = {
  name: "listar_setores",
  description: "Lista os setores da empresa (id e nome). Necessário pra criar projeto quando houver mais de um setor.",
  input_schema: { type: "object", properties: {} },
  run: async (_i, ctx) => {
    const rows = await prisma.setor.findMany({
      where: { companyId: ctx.companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return ok(rows.map((s) => `- ${s.name} · id=${s.id}`).join("\n") || "Nenhum setor.", { data: rows });
  },
};

export const resumoCliente: ToolDef<{ clientCompanyId: string }> = {
  name: "resumo_cliente",
  description:
    "Visão 360º de um cliente: vendas/contratos (com id pra usar como contratoId, status do aceite, faturamento confirmado, produção e o que ainda trava), origem (lead), links da pasta do Drive e da lista do ClickUp, projetos ativos, chamados abertos, cobranças em aberto/atrasadas, serviços contratados, último contato no WhatsApp e os 5 últimos eventos da linha do tempo. Use quando o usuário perguntar 'como está o cliente X'.",
  input_schema: {
    type: "object",
    properties: { clientCompanyId: { type: "string" } },
    required: ["clientCompanyId"],
  },
  run: async ({ clientCompanyId }, ctx) => {
    const client = await prisma.company.findFirst({
      where: { id: clientCompanyId, parentCompanyId: ctx.companyId },
      select: { id: true, name: true, phone: true, email: true, status: true, driveFolderUrl: true, clickupListUrl: true },
    });
    if (!client) return fail("Cliente não encontrado na carteira.");

    const now = ctx.now;
    const [sales, recent, projects, tickets, invoices, services, lastMsg] = await Promise.all([
      prisma.sale.findMany({
        where: { clientCompanyId, companyId: ctx.companyId },
        orderBy: { closedAt: "desc" },
        take: 10,
        include: { lead: { select: { id: true, name: true, createdAt: true } }, project: { select: { name: true } } },
      }),
      buildClientTimeline(clientCompanyId, ctx.companyId, { viewerUserId: ctx.userId, limit: 5 }),
      prisma.setorClickupList.findMany({
        where: { clientCompanyId, setor: { companyId: ctx.companyId }, status: { notIn: ["ENTREGUE", "CANCELADO"] } },
        select: { id: true, name: true, status: true, dueDate: true, _count: { select: { internalTasks: { where: { done: false, ignoredAt: null } } } } },
        take: 10,
      }),
      prisma.ticket.findMany({
        where: { clientCompanyId, companyId: ctx.companyId, status: { in: ["OPEN", "IN_PROGRESS"] } },
        select: { id: true, title: true, status: true, priority: true, dueDate: true, assignee: { select: { name: true } } },
        orderBy: { dueDate: "asc" }, take: 10,
      }),
      prisma.clientInvoice.findMany({
        where: { clientCompanyId, status: "ABERTO" },
        select: { id: true, description: true, amountCents: true, dueDate: true },
        orderBy: { dueDate: "asc" }, take: 10,
      }),
      prisma.clientService.findMany({
        where: { clientCompanyId, status: "ATIVO" },
        select: { label: true, amountCents: true, isRecurring: true, billingCycle: true },
        take: 10,
      }),
      client.phone
        ? prisma.message.findFirst({
            where: { companyId: ctx.companyId, phone: client.phone.replace(/\D/g, "") },
            orderBy: { receivedAt: "desc" },
            select: { receivedAt: true, direction: true, body: true },
          })
        : Promise.resolve(null),
    ]);

    const out: string[] = [`Cliente: ${client.name}${client.status !== "ACTIVE" ? " (INATIVO)" : ""}`];
    out.push(`Pasta no Drive: ${client.driveFolderUrl ?? "não cadastrada"} · Lista no ClickUp: ${client.clickupListUrl ?? "não cadastrada"}`);
    const origem = sales.filter((s) => s.lead).at(-1)?.lead;
    out.push(`Origem: ${origem ? `lead "${origem.name ?? "sem nome"}" (id=${origem.id}, criado ${fmtDate(origem.createdAt)})` : "sem lead de origem registrado"}`);
    if (sales.length === 0) {
      out.push("Vendas/contratos: nenhuma venda vinculada a este cliente.");
    } else {
      out.push(`Vendas/contratos (${sales.length}):`);
      for (const s of sales) {
        const aceite = s.acceptedAt
          ? `aceito em ${fmtDate(s.acceptedAt)} via ${ACCEPTANCE_LABEL[s.acceptanceType ?? ""] ?? s.acceptanceType}${s.acceptanceUrl ? ` (${s.acceptanceUrl.startsWith("/") ? appUrl(s.acceptanceUrl) : s.acceptanceUrl})` : ""}`
          : `contrato ${CONTRACT_STATUS_LABEL[s.contractStatus] ?? s.contractStatus}, SEM aceite registrado`;
        const fat = s.billingConfirmed ? `faturamento confirmado por ${s.billingConfirmedBy} em ${fmtDate(s.billingConfirmedAt)}` : "faturamento NÃO confirmado";
        const prod = s.productionStatus === "PENDENTE"
          ? `produção a liberar${productionBlocker(s) ? ` (${productionBlocker(s)})` : " (pronta pra liberar)"}`
          : `produção ${s.productionStatus === "LIBERADO" ? "em andamento" : s.productionStatus.toLowerCase()}${s.project ? ` — projeto "${s.project.name}"` : ""}`;
        out.push(`  - ${s.title} · contratoId=${s.id} · ${brl(s.valueCents)} · fechada ${fmtDate(s.closedAt)} · ${aceite} · ${fat} · ${prod}`);
      }
    }
    out.push(`Projetos ativos (${projects.length}): ${projects.map((p) => `${p.name} [${p.status}, ${p._count.internalTasks} tarefas abertas, prazo ${fmtDate(p.dueDate)}]`).join("; ") || "nenhum"}`);
    out.push(`Chamados abertos (${tickets.length}): ${tickets.map((t) => `${t.title} [${t.priority}, ${t.assignee?.name ?? "sem responsável"}, prazo ${fmtDateTime(t.dueDate)}]`).join("; ") || "nenhum"}`);
    const overdue = invoices.filter((i) => i.dueDate < now);
    out.push(`Cobranças em aberto: ${invoices.length} (${brl(invoices.reduce((a, i) => a + i.amountCents, 0))}); atrasadas: ${overdue.length} (${brl(overdue.reduce((a, i) => a + i.amountCents, 0))})`);
    out.push(`Contratos ativos: ${services.map((s) => `${s.label}${s.amountCents ? ` ${brl(s.amountCents)}${s.isRecurring ? `/${(s.billingCycle ?? "MENSAL").toLowerCase()}` : ""}` : ""}`).join("; ") || "nenhum"}`);
    if (lastMsg) out.push(`Último contato WhatsApp: ${fmtDateTime(lastMsg.receivedAt)} (${lastMsg.direction === "INBOUND" ? "cliente escreveu" : "nós escrevemos"}): "${lastMsg.body.slice(0, 80)}"`);
    out.push(`Últimos eventos: ${recent.length ? "" : "nenhum"}`);
    for (const e of recent) out.push(`  - [${fmtDate(new Date(e.at))}] ${TIMELINE_LABEL[e.type]}: ${e.title}`);
    out.push(`Link: ${appUrl(`/empresas/${client.id}`)}`);
    return ok(out.join("\n"), { data: { client, sales, recent, projects, tickets, invoices, services, lastMsg } });
  },
};

export const consultaTools: ToolDef[] = [buscarCliente, listarProjetos, listarUsuarios, listarSetores, resumoCliente];
