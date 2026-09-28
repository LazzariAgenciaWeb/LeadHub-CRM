import { prisma } from "@/lib/prisma";
import { findOrCreateClientCompany } from "@/lib/client-company";
import { loadCompanyHours, clampDueDateToBusinessHours } from "@/lib/business-hours";
import { type ToolDef, ok, fail, appUrl, parseDate, fmtDateTime, fmtDate } from "./types";

/** Ferramentas de CRIAÇÃO: chamado, tarefa de projeto, projeto, cliente. */

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

async function resolveClient(ctx: { companyId: string }, id?: string, name?: string): Promise<string | null> {
  if (id) {
    const c = await prisma.company.findFirst({ where: { id, parentCompanyId: ctx.companyId }, select: { id: true } });
    if (c) return c.id;
  }
  if (name?.trim()) {
    return findOrCreateClientCompany({ name: name.trim(), parentCompanyId: ctx.companyId });
  }
  return null;
}

export const criarChamado: ToolDef<{
  title: string; description?: string; dueDate: string; priority?: string;
  type?: "SUPPORT" | "INTERNAL"; clientCompanyId?: string; clientCompanyName?: string;
  assigneeId?: string; projetoId?: string;
}> = {
  name: "criar_chamado",
  description:
    "Cria um chamado (ticket). type=SUPPORT é demanda de um cliente (informe clientCompanyId — use buscar_cliente — ou clientCompanyName pra criar o cliente na hora); type=INTERNAL é tarefa interna da equipe sem cliente. dueDate obrigatório (ISO 8601 com offset -03:00); se o usuário não disser prazo, assuma o fim do próximo dia útil. Sem assigneeId, o chamado fica com o próprio usuário.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string", description: "Detalhes. Se não houver, repita o título." },
      dueDate: { type: "string", description: "ISO 8601, ex: 2026-10-02T15:00:00-03:00" },
      priority: { type: "string", enum: [...PRIORITIES] },
      type: { type: "string", enum: ["SUPPORT", "INTERNAL"] },
      clientCompanyId: { type: "string" },
      clientCompanyName: { type: "string" },
      assigneeId: { type: "string", description: "Default: o próprio usuário" },
      projetoId: { type: "string" },
    },
    required: ["title", "dueDate"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const due = parseDate(input.dueDate);
    if (!due) return fail("dueDate inválido.");
    const type = input.type === "INTERNAL" ? "INTERNAL" : "SUPPORT";
    const clientId = type === "SUPPORT" ? await resolveClient(ctx, input.clientCompanyId, input.clientCompanyName) : null;

    let projetoId: string | null = null;
    let projectListId: string | null = null;
    if (input.projetoId) {
      const p = await prisma.setorClickupList.findFirst({
        where: { id: input.projetoId, setor: { companyId: ctx.companyId } },
        select: { id: true, clickupListId: true },
      });
      if (p) { projetoId = p.id; projectListId = p.clickupListId; }
    }
    if (input.assigneeId) {
      const u = await prisma.user.findFirst({ where: { id: input.assigneeId, companyId: ctx.companyId }, select: { id: true } });
      if (!u) return fail("assigneeId não pertence à empresa.");
    }

    const hours = await loadCompanyHours(ctx.companyId);
    const dueFinal = clampDueDateToBusinessHours(due, hours);
    const description = (input.description ?? "").trim() || input.title;

    const ticket = await prisma.ticket.create({
      data: {
        title: input.title.trim(),
        description,
        priority: (PRIORITIES as readonly string[]).includes(input.priority ?? "") ? (input.priority as any) : "MEDIUM",
        companyId: ctx.companyId,
        createdById: ctx.userId,
        type,
        dueDate: dueFinal,
        clientCompanyId: clientId,
        assigneeId: input.assigneeId ?? ctx.userId,
        projetoId,
        messages: {
          create: { body: description, authorName: ctx.userName, authorRole: ctx.role, isInternal: false, source: "LEADHUB" },
        },
      },
      select: { id: true, title: true, dueDate: true, clientCompany: { select: { name: true } } },
    });

    // ClickUp (best-effort, só SUPPORT) — mesmo comportamento do POST /api/tickets.
    if (type === "SUPPORT") {
      try {
        const { getClickupSettings, syncTicketToClickup } = await import("@/lib/clickup");
        const settings = await getClickupSettings(ctx.companyId);
        if (settings) {
          const clickupTaskId = await syncTicketToClickup({
            settings, ticketId: ticket.id, title: ticket.title, description,
            priority: input.priority ?? "MEDIUM", status: "OPEN",
            targetListId: projectListId ?? undefined,
          });
          if (clickupTaskId) await prisma.ticket.update({ where: { id: ticket.id }, data: { clickupTaskId } });
        }
      } catch (e) { console.error("[assistente] clickup sync chamado:", e); }
    }

    const link = appUrl(`/chamados/${ticket.id}`);
    return ok(
      `Chamado criado: "${ticket.title}"${ticket.clientCompany ? ` · cliente ${ticket.clientCompany.name}` : type === "INTERNAL" ? " · interno" : ""} · prazo ${fmtDateTime(ticket.dueDate)}`,
      { data: { id: ticket.id }, link },
    );
  },
};

export const criarTarefaProjeto: ToolDef<{
  projetoId: string; title: string; description?: string; dueDate?: string; priority?: string; assigneeId?: string;
}> = {
  name: "criar_tarefa_projeto",
  description:
    "Cria uma tarefa interna dentro de um projeto (use listar_projetos pra achar o projetoId). dueDate opcional (ISO 8601). Sem assigneeId a tarefa fica com o próprio usuário.",
  input_schema: {
    type: "object",
    properties: {
      projetoId: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      dueDate: { type: "string" },
      priority: { type: "string", enum: [...PRIORITIES] },
      assigneeId: { type: "string" },
    },
    required: ["projetoId", "title"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const project = await prisma.setorClickupList.findFirst({
      where: { id: input.projetoId, setor: { companyId: ctx.companyId } },
      select: { id: true, name: true },
    });
    if (!project) return fail("Projeto não encontrado.");
    const due = input.dueDate ? parseDate(input.dueDate) : null;
    if (input.dueDate && !due) return fail("dueDate inválido.");

    const task = await prisma.projectTask.create({
      data: {
        projectId: project.id,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        priority: (PRIORITIES as readonly string[]).includes(input.priority ?? "") ? (input.priority as any) : "MEDIUM",
        dueDate: due,
        assigneeId: input.assigneeId ?? ctx.userId,
        createdById: ctx.userId,
        events: { create: { projectId: project.id, type: "CREATED", toText: input.title.trim(), authorId: ctx.userId, authorName: ctx.userName } },
      },
      select: { id: true },
    });
    await prisma.projectActivity.create({
      data: { projectId: project.id, type: "TASK_CREATED", taskName: input.title.trim(), taskId: task.id, authorId: ctx.userId, authorName: ctx.userName },
    }).catch(() => {});

    return ok(
      `Tarefa criada no projeto "${project.name}": "${input.title.trim()}"${due ? ` · prazo ${fmtDateTime(due)}` : ""}`,
      { data: { id: task.id, projectId: project.id }, link: appUrl(`/projetos/${project.id}`) },
    );
  },
};

export const criarProjeto: ToolDef<{
  name: string; clientCompanyId?: string; clientCompanyName?: string; setorId?: string;
  type?: string; description?: string; dueDate?: string;
}> = {
  name: "criar_projeto",
  description:
    "Cria um projeto rápido (sem ClickUp). Informe o cliente por clientCompanyId ou clientCompanyName. setorId só é necessário se a empresa tiver mais de um setor (use listar_setores). type opcional: SITE, MIDIA, CAMPANHA, OUTRO.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      clientCompanyId: { type: "string" },
      clientCompanyName: { type: "string" },
      setorId: { type: "string" },
      type: { type: "string" },
      description: { type: "string" },
      dueDate: { type: "string" },
    },
    required: ["name"],
  },
  mutating: true,
  run: async (input, ctx) => {
    let setorId = input.setorId ?? null;
    if (setorId) {
      const s = await prisma.setor.findFirst({ where: { id: setorId, companyId: ctx.companyId }, select: { id: true } });
      if (!s) return fail("setorId inválido.");
    } else {
      // Sem setor informado: prefere o setor do usuário; senão o único da empresa.
      const mine = await prisma.setorUser.findFirst({ where: { userId: ctx.userId, setor: { companyId: ctx.companyId } }, select: { setorId: true } });
      if (mine) setorId = mine.setorId;
      else {
        const all = await prisma.setor.findMany({ where: { companyId: ctx.companyId }, select: { id: true }, take: 2 });
        if (all.length === 1) setorId = all[0].id;
        else if (all.length === 0) return fail("A empresa não tem setor cadastrado. Crie um setor em Configurações.");
        else return fail("Há mais de um setor: informe setorId (use listar_setores).");
      }
    }
    const clientId = await resolveClient(ctx, input.clientCompanyId, input.clientCompanyName);
    const due = input.dueDate ? parseDate(input.dueDate) : null;

    const project = await prisma.setorClickupList.create({
      data: {
        setorId,
        name: input.name.trim(),
        clickupListId: null,
        type: input.type?.trim() || null,
        description: input.description?.trim() || null,
        clientCompanyId: clientId,
        dueDate: due,
        status: "PLANEJAMENTO",
        members: { create: { userId: ctx.userId, role: "LEAD" } },
      },
      select: { id: true, name: true, clientCompany: { select: { name: true } } },
    });
    return ok(
      `Projeto criado: "${project.name}"${project.clientCompany ? ` · cliente ${project.clientCompany.name}` : ""}${due ? ` · prazo ${fmtDate(due)}` : ""}`,
      { data: { id: project.id }, link: appUrl(`/projetos/${project.id}`) },
    );
  },
};

export const criarCliente: ToolDef<{ name: string; phone?: string; email?: string; segment?: string; contactName?: string }> = {
  name: "criar_cliente",
  description:
    "Cadastra uma empresa-cliente na carteira (ou devolve a existente se o nome já existir). Opcional: telefone (com DDD), e-mail, segmento e nome do contato principal.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      phone: { type: "string" },
      email: { type: "string" },
      segment: { type: "string" },
      contactName: { type: "string" },
    },
    required: ["name"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const phone = input.phone?.replace(/\D/g, "") || null;
    const before = await prisma.company.findFirst({
      where: { parentCompanyId: ctx.companyId, name: { equals: input.name.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    const id = await findOrCreateClientCompany({ name: input.name, phone, email: input.email ?? null, parentCompanyId: ctx.companyId });
    if (!before && input.segment) {
      await prisma.company.update({ where: { id }, data: { segment: input.segment.trim() } }).catch(() => {});
    }
    if (phone) {
      await prisma.companyContact.upsert({
        where: { companyId_phone: { companyId: id, phone } },
        update: { name: input.contactName?.trim() || undefined },
        create: { companyId: id, phone, name: input.contactName?.trim() || null, role: "CONTACT" },
      }).catch(() => {});
    }
    return ok(
      before ? `Cliente "${input.name.trim()}" já existia (id=${id}).` : `Cliente cadastrado: "${input.name.trim()}" (id=${id}).`,
      { data: { id, existed: !!before }, link: appUrl(`/empresas/${id}`) },
    );
  },
};

export const criarTools: ToolDef[] = [criarChamado, criarTarefaProjeto, criarProjeto, criarCliente];
