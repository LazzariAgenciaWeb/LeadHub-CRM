import { prisma } from "@/lib/prisma";
import { type ToolDef, ok, fail, parseDate, fmtDateTime, appUrl } from "./types";
import { logNoteEvent, describeEdit } from "@/lib/personal-assistant/note-events";
import { findSimilarOpenNote, appendToNote } from "@/lib/personal-assistant/dedupe";

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

const FORCAR_PROP = { type: "boolean", description: "true = criar um item novo mesmo que já exista um do mesmo assunto (default: acrescenta ao existente)." } as const;

/**
 * Cria no bloquinho — ou, se já houver um item ABERTO do mesmo assunto,
 * acrescenta o conteúdo novo nele (data + origem) em vez de duplicar.
 */
async function createOrAppend(ctx: { userId: string; companyId: string; channel: string }, input: {
  kind: Kind; title: string; body?: string | null; dueAt?: Date | null; clientCompanyId?: string | null; tags?: string[]; forcarNovo?: boolean;
}): Promise<{ created: boolean; id: string; title: string }> {
  const title = input.title.trim();
  const tags = cleanTags(input.tags);
  if (!input.forcarNovo) {
    const similar = await findSimilarOpenNote(ctx.userId, title, { body: input.body ?? null, clientCompanyId: input.clientCompanyId ?? null, kind: input.kind });
    if (similar) {
      await appendToNote(similar.id, { title, body: input.body ?? null, tags, dueAt: input.dueAt ?? null, source: ctx.channel });
      return { created: false, id: similar.id, title: similar.title };
    }
  }
  const n = await prisma.assistantNote.create({
    data: { userId: ctx.userId, companyId: ctx.companyId, kind: input.kind, title, body: input.body?.trim() || null, dueAt: input.dueAt ?? null, source: ctx.channel, clientCompanyId: input.clientCompanyId ?? null, tags },
    select: { id: true },
  });
  await logNoteEvent(n.id, "CREATED", ctx.channel);
  return { created: true, id: n.id, title };
}

export const anotar: ToolDef<{ kind?: "IDEA" | "NOTE"; title: string; body?: string; clientCompanyId?: string; tags?: string[]; forcarNovo?: boolean }> = {
  name: "anotar",
  description:
    "Guarda uma ideia (kind=IDEA) ou nota livre (kind=NOTE) no bloquinho do usuário. Use quando ele disser 'anota aí', 'tive uma ideia', 'lembrar que...' sem data. title = frase curta; body = o resto do conteúdo, se houver. Se já existir item aberto do mesmo assunto, o conteúdo é ACRESCENTADO nele (não duplica).",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["IDEA", "NOTE"] },
      title: { type: "string" },
      body: { type: "string" },
      clientCompanyId: { type: "string", description: "Se a nota for sobre um cliente específico" },
      tags: TAGS_PROP,
      forcarNovo: FORCAR_PROP,
    },
    required: ["title"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const kind: Kind = input.kind === "IDEA" ? "IDEA" : "NOTE";
    const r = await createOrAppend(ctx, { kind, title: input.title, body: input.body, clientCompanyId: input.clientCompanyId, tags: input.tags, forcarNovo: input.forcarNovo });
    return ok(r.created ? `${KIND_LABEL[kind]} guardada: "${r.title}"` : `📎 Acrescentado ao item existente "${r.title}" (mesmo assunto).`, { data: { id: r.id, appended: !r.created }, link: appUrl("/assistente?aba=bloquinho") });
  },
};

export const criarLembrete: ToolDef<{ title: string; dueAt: string; body?: string; tags?: string[]; forcarNovo?: boolean }> = {
  name: "criar_lembrete",
  description:
    "Cria um lembrete com data e hora (ISO 8601 com offset -03:00). Na hora marcada o usuário recebe a mensagem no WhatsApp e no app. Use pra 'me lembra de X às Y'. Se o usuário disser só o dia, assuma 09:00. Se já existir item aberto do mesmo assunto, acrescenta nele e antecipa o prazo se o novo for antes.",
  input_schema: {
    type: "object",
    properties: { title: { type: "string" }, dueAt: { type: "string" }, body: { type: "string" }, tags: TAGS_PROP, forcarNovo: FORCAR_PROP },
    required: ["title", "dueAt"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const due = parseDate(input.dueAt);
    if (!due) return fail("dueAt inválido.");
    const r = await createOrAppend(ctx, { kind: "REMINDER", title: input.title, body: input.body, dueAt: due, tags: input.tags, forcarNovo: input.forcarNovo });
    return ok(r.created ? `⏰ Lembrete criado: "${r.title}" em ${fmtDateTime(due)}` : `📎 Acrescentado ao item existente "${r.title}" (mesmo assunto); prazo ${fmtDateTime(due)} considerado.`, { data: { id: r.id, appended: !r.created } });
  },
};

export const criarTarefaPessoal: ToolDef<{ title: string; dueAt?: string; body?: string; clientCompanyId?: string; tags?: string[]; forcarNovo?: boolean }> = {
  name: "criar_tarefa_pessoal",
  description:
    "Cria uma tarefa pessoal rápida (to-do do próprio usuário, fora de projetos e chamados). dueAt opcional (ISO 8601). Aparece na fila do dia. Prefira criar_chamado quando for demanda de cliente ou da equipe, e criar_tarefa_projeto quando pertencer a um projeto. Se já existir item aberto do mesmo assunto, o conteúdo é ACRESCENTADO nele (não duplica).",
  input_schema: {
    type: "object",
    properties: { title: { type: "string" }, dueAt: { type: "string" }, body: { type: "string" }, clientCompanyId: { type: "string" }, tags: TAGS_PROP, forcarNovo: FORCAR_PROP },
    required: ["title"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const due = input.dueAt ? parseDate(input.dueAt) : null;
    if (input.dueAt && !due) return fail("dueAt inválido.");
    const r = await createOrAppend(ctx, { kind: "TASK", title: input.title, body: input.body, dueAt: due, clientCompanyId: input.clientCompanyId, tags: input.tags, forcarNovo: input.forcarNovo });
    return ok(r.created ? `☑️ Tarefa pessoal criada: "${r.title}"${due ? ` · ${fmtDateTime(due)}` : ""}` : `📎 Acrescentado ao item existente "${r.title}" (mesmo assunto).`, { data: { id: r.id, appended: !r.created } });
  },
};

export const acrescentarAoItem: ToolDef<{ id: string; texto: string; tags?: string[] }> = {
  name: "acrescentar_ao_item",
  description: "Acrescenta informação nova a um item existente do bloquinho (pelo id de listar_anotacoes), sem criar outro. Use quando surgir mais contexto sobre um assunto já anotado.",
  input_schema: { type: "object", properties: { id: { type: "string" }, texto: { type: "string" }, tags: TAGS_PROP }, required: ["id", "texto"] },
  mutating: true,
  run: async ({ id, texto, tags }, ctx) => {
    const n = await prisma.assistantNote.findFirst({ where: { id, userId: ctx.userId }, select: { id: true } });
    if (!n) return fail("Item não encontrado.");
    const r = await appendToNote(id, { body: texto, tags: cleanTags(tags), source: ctx.channel });
    return ok(`📎 Acrescentado em "${r.title}".`);
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

export const notasTools: ToolDef[] = [anotar, criarLembrete, criarTarefaPessoal, listarAnotacoes, editarItem, acrescentarAoItem, concluirItem, reabrirItem, excluirItem];
