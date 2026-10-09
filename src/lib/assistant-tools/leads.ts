import { prisma } from "@/lib/prisma";
import { applyLeadUpdate, type LeadUpdateBody } from "@/lib/leads/update-lead";
import { createConversationEvent } from "@/lib/conversation-events";
import { type ToolDef, ok, fail, appUrl, parseDate, fmtDateTime } from "./types";

/**
 * Leads e oportunidades (CRM). Mesmas regras das telas: etapa vem da config
 * do pipeline (GANHO/PERDIDO derivam status, venda vai pra esteira), ClickUp
 * sincroniza oportunidades, gamificação e timeline — tudo via applyLeadUpdate.
 */

const PIPELINES = ["PROSPECCAO", "LEADS", "OPORTUNIDADES"] as const;
type Pipeline = (typeof PIPELINES)[number];
const PIPELINE_HREF: Record<string, string> = { PROSPECCAO: "/crm/prospeccao", LEADS: "/crm/leads", OPORTUNIDADES: "/crm/oportunidades" };
const leadHref = (l: { id: string; pipeline: string | null }) => appUrl(`${PIPELINE_HREF[l.pipeline ?? ""] ?? "/crm/leads"}?lead=${l.id}`);
const brl = (v: number | null) => (v == null ? "" : ` · R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);

function normPhone(p?: string | null): string {
  return (p ?? "").replace(/\D/g, "");
}

/** Resolve a etapa pelo nome (sem acento/caixa) dentro da config do pipeline. */
async function resolveStage(companyId: string, pipeline: string, wanted?: string | null): Promise<{ name: string } | { error: string }> {
  const stages = await prisma.pipelineStageConfig.findMany({ where: { companyId, pipeline }, orderBy: { order: "asc" }, select: { name: true } });
  if (stages.length === 0) return { error: `Pipeline ${pipeline} sem etapas configuradas.` };
  if (!wanted) return { name: stages[0].name };
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const w = norm(wanted);
  const hit = stages.find((s) => norm(s.name) === w) ?? stages.find((s) => norm(s.name).includes(w) || w.includes(norm(s.name)));
  if (!hit) return { error: `Etapa "${wanted}" não existe em ${pipeline}. Etapas: ${stages.map((s) => s.name).join(", ")}` };
  return { name: hit.name };
}

async function getLead(companyId: string, id: string) {
  return prisma.lead.findFirst({ where: { id, companyId } });
}

function describe(l: { id: string; name: string | null; phone: string; email: string | null; pipeline: string | null; pipelineStage: string | null; status: string; value: number | null; expectedReturnAt: Date | null; updatedAt: Date; notes?: string | null }) {
  return `- ${l.name ?? l.phone ?? l.email ?? "(sem nome)"}${l.phone ? ` · ${l.phone}` : ""} · ${l.pipeline ?? "sem pipeline"}${l.pipelineStage ? ` / ${l.pipelineStage}` : ""} · ${l.status}${brl(l.value)}${l.expectedReturnAt ? ` · retorno ${fmtDateTime(l.expectedReturnAt)}` : ""} · atualizado ${fmtDateTime(l.updatedAt)} · id=${l.id}`;
}

export const buscarLead: ToolDef<{ query: string; pipeline?: Pipeline; incluirFechados?: boolean }> = {
  name: "buscar_lead",
  description:
    "Busca leads/oportunidades do CRM por nome, telefone ou e-mail (parcial). Devolve id, pipeline, etapa, status, valor e retorno agendado. Use antes de mover, comentar ou agendar retorno. Por padrão só abertos (não CLOSED/LOST).",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string" },
      pipeline: { type: "string", enum: [...PIPELINES] },
      incluirFechados: { type: "boolean" },
    },
    required: ["query"],
  },
  run: async ({ query, pipeline, incluirFechados }, ctx) => {
    const q = (query ?? "").trim();
    if (!q) return fail("Informe nome, telefone ou e-mail.");
    const digits = normPhone(q);
    const rows = await prisma.lead.findMany({
      where: {
        companyId: ctx.companyId,
        ...(pipeline ? { pipeline } : {}),
        ...(incluirFechados ? {} : { status: { notIn: ["CLOSED", "LOST"] } }),
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
        ],
      },
      select: { id: true, name: true, phone: true, email: true, pipeline: true, pipelineStage: true, status: true, value: true, expectedReturnAt: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });
    if (rows.length === 0) return ok(`Nenhum lead encontrado para "${q}".`, { data: [] });
    return ok(rows.map(describe).join("\n"), { data: rows });
  },
};

export const listarEtapas: ToolDef<{ pipeline: Pipeline }> = {
  name: "listar_etapas",
  description: "Lista as etapas configuradas de um pipeline (PROSPECCAO, LEADS ou OPORTUNIDADES), na ordem, marcando as de ganho/perda.",
  input_schema: { type: "object", properties: { pipeline: { type: "string", enum: [...PIPELINES] } }, required: ["pipeline"] },
  run: async ({ pipeline }, ctx) => {
    const rows = await prisma.pipelineStageConfig.findMany({ where: { companyId: ctx.companyId, pipeline }, orderBy: { order: "asc" }, select: { name: true, outcome: true, isFinal: true } });
    if (rows.length === 0) return ok(`Pipeline ${pipeline} sem etapas configuradas.`, { data: [] });
    return ok(rows.map((s, i) => `${i + 1}. ${s.name}${s.outcome !== "NEUTRO" ? ` (${s.outcome})` : s.isFinal ? " (final)" : ""}`).join("\n"), { data: rows });
  },
};

export const criarLead: ToolDef<{ name?: string; phone?: string; email?: string; pipeline?: Pipeline; pipelineStage?: string; source?: string; notes?: string; value?: number }> = {
  name: "criar_lead",
  description:
    "Cria um lead (pipeline LEADS, default) ou oportunidade (pipeline OPORTUNIDADES) no CRM. Informe ao menos nome ou telefone (com DDD). Sem pipelineStage, entra na primeira etapa. value em reais (número). Oportunidade sincroniza com o ClickUp quando configurado.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" }, phone: { type: "string" }, email: { type: "string" },
      pipeline: { type: "string", enum: [...PIPELINES], description: "Default LEADS" },
      pipelineStage: { type: "string" }, source: { type: "string", description: "Origem: indicação, Instagram, site…" },
      notes: { type: "string" }, value: { type: "number", description: "Valor em reais" },
    },
  },
  mutating: true,
  run: async (input, ctx) => {
    const name = input.name?.trim() || null;
    const phone = normPhone(input.phone);
    if (!name && !phone) return fail("Informe ao menos o nome ou o telefone.");
    const pipeline: Pipeline = input.pipeline && (PIPELINES as readonly string[]).includes(input.pipeline) ? input.pipeline : "LEADS";

    // Já existe aberto com esse telefone/e-mail? Não duplica — devolve o existente.
    if (phone || input.email) {
      const dup = await prisma.lead.findFirst({
        where: { companyId: ctx.companyId, status: { notIn: ["CLOSED", "LOST"] }, OR: [...(phone ? [{ phone }] : []), ...(input.email ? [{ email: { equals: input.email.trim(), mode: "insensitive" as const } }] : [])] },
        select: { id: true, name: true, phone: true, pipeline: true, pipelineStage: true },
      });
      if (dup) return ok(`Já existe lead aberto: "${dup.name ?? dup.phone}" em ${dup.pipeline ?? "sem pipeline"}${dup.pipelineStage ? ` / ${dup.pipelineStage}` : ""} (id=${dup.id}). Use atualizar_lead pra mover ou comentar_lead.`, { data: { id: dup.id, existed: true }, link: leadHref(dup) });
    }

    const stage = await resolveStage(ctx.companyId, pipeline, input.pipelineStage);
    if ("error" in stage) return fail(stage.error);

    const lead = await prisma.lead.create({
      data: {
        name, phone, email: input.email?.trim() || null, source: input.source?.trim() || null,
        status: "NEW", notes: input.notes?.trim() || null, value: typeof input.value === "number" ? input.value : null,
        companyId: ctx.companyId, pipeline, pipelineStage: stage.name, isInternal: false,
      },
    });

    if (pipeline === "OPORTUNIDADES") {
      try {
        const { getClickupSettings, syncOportunidadeToClickup } = await import("@/lib/clickup");
        const settings = await getClickupSettings(ctx.companyId);
        if (settings?.oportunidadesListId) {
          const taskId = await syncOportunidadeToClickup({ settings, leadId: lead.id, name: lead.name ?? lead.phone, notes: lead.notes, value: lead.value, pipelineStage: lead.pipelineStage });
          if (taskId) await prisma.lead.update({ where: { id: lead.id }, data: { clickupTaskId: taskId } });
        }
      } catch (e) { console.error("[assistente] clickup oportunidade:", e); }
    }
    if (lead.phone) {
      void createConversationEvent({
        companyId: ctx.companyId, phone: lead.phone, type: pipeline === "OPORTUNIDADES" ? "OPP_CREATED" : "LEAD_CREATED",
        message: `${pipeline === "OPORTUNIDADES" ? "Oportunidade" : "Lead"} criada: ${lead.name ?? lead.phone}${brl(lead.value)}`,
        authorId: ctx.userId, authorName: ctx.userName, meta: { leadId: lead.id },
      });
    }
    return ok(`${pipeline === "OPORTUNIDADES" ? "💰 Oportunidade" : "🎯 Lead"} criado: "${lead.name ?? lead.phone}" em ${pipeline} / ${stage.name}${brl(lead.value)}`, { data: { id: lead.id }, link: leadHref(lead) });
  },
};

export const atualizarLead: ToolDef<{
  id: string; pipeline?: Pipeline; pipelineStage?: string; status?: "NEW" | "CONTACTED" | "PROPOSAL" | "CLOSED" | "LOST";
  value?: number | null; expectedReturnAt?: string | null; name?: string; email?: string; phone?: string; notes?: string;
}> = {
  name: "atualizar_lead",
  description:
    "Atualiza um lead/oportunidade: mover de pipeline e/ou etapa (use listar_etapas; etapa de GANHO marca como vendido e cria a venda; PERDIDO marca perdido), definir valor (reais), agendar retorno (expectedReturnAt ISO 8601 -03:00; null limpa), corrigir nome/e-mail/telefone, substituir notas. Pra marcar como ganho/perdido prefira mover pra etapa correspondente. Pra adicionar observação sem sobrescrever, use comentar_lead.",
  input_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      pipeline: { type: "string", enum: [...PIPELINES] },
      pipelineStage: { type: "string" },
      status: { type: "string", enum: ["NEW", "CONTACTED", "PROPOSAL", "CLOSED", "LOST"] },
      value: { type: ["number", "null"] },
      expectedReturnAt: { type: ["string", "null"] },
      name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, notes: { type: "string" },
    },
    required: ["id"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const existing = await getLead(ctx.companyId, input.id);
    if (!existing) return fail("Lead não encontrado.");
    const body: LeadUpdateBody = {};
    const destPipeline = input.pipeline ?? existing.pipeline ?? "LEADS";
    if (input.pipeline && input.pipeline !== existing.pipeline) body.pipeline = input.pipeline;
    if (input.pipelineStage || (input.pipeline && input.pipeline !== existing.pipeline)) {
      const stage = await resolveStage(ctx.companyId, destPipeline, input.pipelineStage);
      if ("error" in stage) return fail(stage.error);
      body.pipelineStage = stage.name;
    }
    if (input.status) body.status = input.status;
    if (input.value !== undefined) body.value = input.value;
    if (input.expectedReturnAt !== undefined) {
      if (input.expectedReturnAt === null) body.expectedReturnAt = null;
      else { const d = parseDate(input.expectedReturnAt); if (!d) return fail("expectedReturnAt inválido."); body.expectedReturnAt = d; }
    }
    if (input.name?.trim()) body.name = input.name.trim();
    if (input.email?.trim()) body.email = input.email.trim();
    if (input.phone) body.phone = normPhone(input.phone);
    if (input.notes !== undefined) body.notes = input.notes;
    if (Object.keys(body).length === 0) return fail("Nada pra atualizar.");

    const lead = await applyLeadUpdate(existing, body, { id: ctx.userId, name: ctx.userName });
    const changes: string[] = [];
    if (body.pipeline) changes.push(`pipeline → ${body.pipeline}`);
    if (body.pipelineStage) changes.push(`etapa → ${body.pipelineStage}`);
    if (lead.status !== existing.status) changes.push(`status → ${lead.status}${lead.status === "CLOSED" ? " (vendido 🎉)" : lead.status === "LOST" ? " (perdido)" : ""}`);
    if (body.value !== undefined) changes.push(`valor${brl(lead.value) || " removido"}`);
    if (body.expectedReturnAt !== undefined) changes.push(body.expectedReturnAt ? `retorno ${fmtDateTime(lead.expectedReturnAt)}` : "retorno limpo");
    if (body.name) changes.push("nome"); if (body.email) changes.push("e-mail"); if (body.phone) changes.push("telefone"); if (body.notes !== undefined) changes.push("notas");
    return ok(`✏️ ${lead.name ?? lead.phone}: ${changes.join(", ")}`, { data: { id: lead.id, status: lead.status, pipeline: lead.pipeline, pipelineStage: lead.pipelineStage }, link: leadHref(lead) });
  },
};

export const comentarLead: ToolDef<{ id: string; texto: string }> = {
  name: "comentar_lead",
  description: "Adiciona um comentário na timeline do lead/oportunidade (histórico da negociação), sem mexer nas notas principais.",
  input_schema: { type: "object", properties: { id: { type: "string" }, texto: { type: "string" } }, required: ["id", "texto"] },
  mutating: true,
  run: async ({ id, texto }, ctx) => {
    const lead = await getLead(ctx.companyId, id);
    if (!lead) return fail("Lead não encontrado.");
    const t = (texto ?? "").trim();
    if (!t) return fail("Comentário vazio.");
    await prisma.leadComment.create({ data: { leadId: id, body: t, authorName: ctx.userName } });
    if (lead.clickupTaskId) {
      try {
        const { getClickupSettings, addCommentToClickupTask } = await import("@/lib/clickup");
        const settings = await getClickupSettings(ctx.companyId);
        if (settings) await addCommentToClickupTask({ apiToken: settings.apiToken, taskId: lead.clickupTaskId, comment: `💬 ${ctx.userName}: ${t}` });
      } catch (e) { console.error("[assistente] clickup comentário:", e); }
    }
    return ok(`💬 Comentário registrado em "${lead.name ?? lead.phone}".`, { link: leadHref(lead) });
  },
};

export const criarTarefaLead: ToolDef<{ leadId: string; title: string; dueAt: string; notes?: string }> = {
  name: "criar_tarefa_lead",
  description: "Cria uma tarefa vinculada a um lead/oportunidade (ex.: 'enviar proposta', 'ligar'), com prazo (ISO 8601). Aparece na fila do dia e no card do lead. Fica com o próprio usuário.",
  input_schema: { type: "object", properties: { leadId: { type: "string" }, title: { type: "string" }, dueAt: { type: "string" }, notes: { type: "string" } }, required: ["leadId", "title", "dueAt"] },
  mutating: true,
  run: async (input, ctx) => {
    const lead = await getLead(ctx.companyId, input.leadId);
    if (!lead) return fail("Lead não encontrado.");
    const due = parseDate(input.dueAt);
    if (!due) return fail("dueAt inválido.");
    const t = await prisma.task.create({
      data: { title: input.title.trim(), dueAt: due, notes: input.notes?.trim() || null, leadId: lead.id, companyId: ctx.companyId, assigneeId: ctx.userId, createdById: ctx.userId },
      select: { id: true },
    });
    return ok(`☑️ Tarefa "${input.title.trim()}" criada no lead ${lead.name ?? lead.phone} · ${fmtDateTime(due)}`, { data: { id: t.id }, link: leadHref(lead) });
  },
};

export const leadsTools: ToolDef[] = [buscarLead, listarEtapas, criarLead, atualizarLead, comentarLead, criarTarefaLead];
