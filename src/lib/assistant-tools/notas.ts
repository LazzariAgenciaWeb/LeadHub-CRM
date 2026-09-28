import { prisma } from "@/lib/prisma";
import { type ToolDef, ok, fail, parseDate, fmtDateTime, appUrl } from "./types";
import { logNoteEvent, describeEdit } from "@/lib/personal-assistant/note-events";

/**
 * O "bloquinho": ideias, notas, lembretes e tarefas pessoais (AssistantNote).
 * Coisas que não são chamado nem tarefa de projeto — só pra não esquecer.
 */

const KINDS = ["IDEA", "NOTE", "REMINDER", "TASK"] as const;
type Kind = (typeof KINDS)[number];
const KIND_LABEL: Record<Kind, string> = { IDEA: "💡 Ideia", NOTE: "📝 Nota", REMINDER: "⏰ Lembrete", TASK: "☑️ Tarefa" };

const TAGS_PROP = { type: "array", items: { type: "string" }, description: "Etiquetas curtas em minúsculas pra organizar (ex.: pessoal, financeiro, cliente, marketing, equipe). Infira pelo contexto; 1 a 3." } as const;
function cleanTags(t: unknown): string[] {
  if (!Array.isArray(t)) return [];
  return [...new Set(t.filter((x) => typeof x === "string").map((x) => x.trim().toLowerCase().replace(/^#/, "")).filter(Boolean))].slice(0, 6);
}

export const anotar: ToolDef<{ kind?: "IDEA" | "NOTE"; title: string; body?: string; clientCompanyId?: string; tags?: string[] }> = {
  name: "anotar",
  description:
    "Guarda uma ideia (kind=IDEA) ou nota livre (kind=NOTE) no bloquinho do usuário. Use quando ele disser 'anota aí', 'tive uma ideia', 'lembrar que...' sem data. title = frase curta; body = o resto do conteúdo, se houver.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["IDEA", "NOTE"] },
      title: { type: "string" },
      body: { type: "string" },
      clientCompanyId: { type: "string", description: "Se a nota for sobre um cliente específico" },
      tags: TAGS_PROP,
    },
    required: ["title"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const kind: Kind = input.kind === "IDEA" ? "IDEA" : "NOTE";
    const n = await prisma.assistantNote.create({
      data: { userId: ctx.userId, companyId: ctx.companyId, kind, title: input.title.trim(), body: input.body?.trim() || null, source: ctx.channel, clientCompanyId: input.clientCompanyId ?? null, tags: cleanTags(input.tags) },
      select: { id: true },
    });
    return ok(`${KIND_LABEL[kind]} guardada: "${input.title.trim()}"`, { data: { id: n.id }, link: appUrl("/assistente?aba=bloquinho") });
  },
};

export const criarLembrete: ToolDef<{ title: string; dueAt: string; body?: string; tags?: string[] }> = {
  name: "criar_lembrete",
  description:
    "Cria um lembrete com data e hora (ISO 8601 com offset -03:00). Na hora marcada o usuário recebe a mensagem no WhatsApp e no app. Use pra 'me lembra de X às Y'. Se o usuário disser só o dia, assuma 09:00.",
  input_schema: {
    type: "object",
    properties: { title: { type: "string" }, dueAt: { type: "string" }, body: { type: "string" }, tags: TAGS_PROP },
    required: ["title", "dueAt"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const due = parseDate(input.dueAt);
    if (!due) return fail("dueAt inválido.");
    const n = await prisma.assistantNote.create({
      data: { userId: ctx.userId, companyId: ctx.companyId, kind: "REMINDER", title: input.title.trim(), body: input.body?.trim() || null, dueAt: due, source: ctx.channel, tags: cleanTags(input.tags) },
      select: { id: true },
    });
    await logNoteEvent(n.id, "CREATED", ctx.channel);
    return ok(`⏰ Lembrete criado: "${input.title.trim()}" em ${fmtDateTime(due)}`, { data: { id: n.id } });
  },
};

export const criarTarefaPessoal: ToolDef<{ title: string; dueAt?: string; body?: string; clientCompanyId?: string; tags?: string[] }> = {
  name: "criar_tarefa_pessoal",
  description:
    "Cria uma tarefa pessoal rápida (to-do do próprio usuário, fora de projetos e chamados). dueAt opcional (ISO 8601). Aparece na fila do dia. Prefira criar_chamado quando for demanda de cliente ou da equipe, e criar_tarefa_projeto quando pertencer a um projeto.",
  input_schema: {
    type: "object",
    properties: { title: { type: "string" }, dueAt: { type: "string" }, body: { type: "string" }, clientCompanyId: { type: "string" }, tags: TAGS_PROP },
    required: ["title"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const due = input.dueAt ? parseDate(input.dueAt) : null;
    if (input.dueAt && !due) return fail("dueAt inválido.");
    const n = await prisma.assistantNote.create({
      data: { userId: ctx.userId, companyId: ctx.companyId, kind: "TASK", title: input.title.trim(), body: input.body?.trim() || null, dueAt: due, source: ctx.channel, clientCompanyId: input.clientCompanyId ?? null, tags: cleanTags(input.tags) },
      select: { id: true },
    });
    await logNoteEvent(n.id, "CREATED", ctx.channel);
    return ok(`☑️ Tarefa pessoal criada: "${input.title.trim()}"${due ? ` · ${fmtDateTime(due)}` : ""}`, { data: { id: n.id } });
  },
};

export const listarAnotacoes: ToolDef<{ kind?: Kind; incluirConcluidas?: boolean; query?: string; tag?: string }> = {
  name: "listar_anotacoes",
  description:
    "Lista o bloquinho do usuário: ideias, notas, lembretes e tarefas pessoais pendentes. Filtre por kind ou trecho de texto. Retorna id de cada item (necessário pra concluir/excluir).",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: [...KINDS] },
      incluirConcluidas: { type: "boolean" },
      query: { type: "string" },
      tag: { type: "string", description: "Filtra por etiqueta (ex.: financeiro)" },
    },
  },
  run: async (input, ctx) => {
    const rows = await prisma.assistantNote.findMany({
      where: {
        userId: ctx.userId,
        ...(input.kind ? { kind: input.kind } : {}),
        ...(input.incluirConcluidas ? {} : { done: false }),
        ...(input.query ? { OR: [{ title: { contains: input.query, mode: "insensitive" } }, { body: { contains: input.query, mode: "insensitive" } }] } : {}),
        ...(input.tag ? { tags: { has: input.tag.trim().toLowerCase() } } : {}),
      },
      orderBy: [{ done: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      take: 30,
      select: { id: true, kind: true, title: true, body: true, dueAt: true, done: true, createdAt: true, tags: true, doneNote: true },
    });
    if (rows.length === 0) return ok("Bloquinho vazio (nada pendente).", { data: [] });
    const lines = rows.map((r) =>
      `- ${KIND_LABEL[r.kind as Kind] ?? r.kind} ${r.done ? "✅ " : ""}"${r.title}"${r.dueAt ? ` · ${fmtDateTime(r.dueAt)}` : ""}${r.body ? ` — ${r.body.slice(0, 80)}` : ""}${r.tags.length ? ` [${r.tags.join(", ")}]` : ""}${r.done && r.doneNote ? ` (feito: ${r.doneNote.slice(0, 60)})` : ""} · id=${r.id}`
    );
    return ok(lines.join("\n"), { data: rows });
  },
};

export const editarItem: ToolDef<{ id: string; title?: string; body?: string; dueAt?: string | null; kind?: Kind; tags?: string[] }> = {
  name: "editar_item",
  description: "Edita um item do bloquinho pelo id: título, texto, data (dueAt ISO ou null pra remover), tipo e etiquetas. Use listar_anotacoes pra achar o id.",
  input_schema: {
    type: "object",
    properties: { id: { type: "string" }, title: { type: "string" }, body: { type: "string" }, dueAt: { type: ["string", "null"] }, kind: { type: "string", enum: [...KINDS] }, tags: TAGS_PROP },
    required: ["id"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const n = await prisma.assistantNote.findFirst({ where: { id: input.id, userId: ctx.userId }, select: { id: true } });
    if (!n) return fail("Item não encontrado.");
    const data: Record<string, unknown> = {};
    if (input.title?.trim()) data.title = input.title.trim();
    if (input.body !== undefined) data.body = input.body?.trim() || null;
    if (input.kind && (KINDS as readonly string[]).includes(input.kind)) data.kind = input.kind;
    if (input.tags !== undefined) data.tags = cleanTags(input.tags);
    if (input.dueAt === null) data.dueAt = null;
    else if (typeof input.dueAt === "string") { const d = parseDate(input.dueAt); if (!d) return fail("dueAt inválido."); data.dueAt = d; data.remindedAt = null; }
    const u = await prisma.assistantNote.update({ where: { id: n.id }, data, select: { title: true, tags: true } });
    await logNoteEvent(n.id, "EDITED", ctx.channel, describeEdit(data));
    return ok(`✏️ Atualizado: "${u.title}"${u.tags.length ? ` [${u.tags.join(", ")}]` : ""}`);
  },
};

export const concluirItem: ToolDef<{ id: string; resultado?: string }> = {
  name: "concluir_item",
  description: "Marca como concluído um item do bloquinho pelo id. Se o usuário disser o que foi feito ('feito, liguei e ele aprovou'), passe em `resultado` — fica registrado no histórico do item.",
  input_schema: { type: "object", properties: { id: { type: "string" }, resultado: { type: "string", description: "O que foi feito / como foi resolvido (opcional)" } }, required: ["id"] },
  mutating: true,
  run: async ({ id, resultado }, ctx) => {
    const n = await prisma.assistantNote.findFirst({ where: { id, userId: ctx.userId }, select: { id: true, title: true } });
    if (!n) return fail("Item não encontrado.");
    const doneNote = resultado?.trim() || null;
    await prisma.assistantNote.update({ where: { id }, data: { done: true, doneAt: ctx.now, ...(doneNote ? { doneNote } : {}) } });
    await logNoteEvent(id, "DONE", ctx.channel, doneNote);
    return ok(`✅ Concluído: "${n.title}"${doneNote ? ` — ${doneNote}` : ""}`);
  },
};

export const reabrirItem: ToolDef<{ id: string }> = {
  name: "reabrir_item",
  description: "Reabre um item do bloquinho já concluído (volta pra pendente).",
  input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  mutating: true,
  run: async ({ id }, ctx) => {
    const n = await prisma.assistantNote.findFirst({ where: { id, userId: ctx.userId }, select: { id: true, title: true } });
    if (!n) return fail("Item não encontrado.");
    await prisma.assistantNote.update({ where: { id }, data: { done: false, doneAt: null } });
    await logNoteEvent(id, "REOPENED", ctx.channel);
    return ok(`↩ Reaberto: "${n.title}"`);
  },
};

export const excluirItem: ToolDef<{ id: string }> = {
  name: "excluir_item",
  description: "Exclui um item do bloquinho pelo id (use quando o usuário disser 'apaga', 'desfaz' logo após criar).",
  input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  mutating: true,
  run: async ({ id }, ctx) => {
    const n = await prisma.assistantNote.findFirst({ where: { id, userId: ctx.userId }, select: { id: true, title: true } });
    if (!n) return fail("Item não encontrado.");
    await prisma.assistantNote.delete({ where: { id } });
    return ok(`🗑️ Excluído: "${n.title}"`);
  },
};

export const notasTools: ToolDef[] = [anotar, criarLembrete, criarTarefaPessoal, listarAnotacoes, editarItem, concluirItem, reabrirItem, excluirItem];
