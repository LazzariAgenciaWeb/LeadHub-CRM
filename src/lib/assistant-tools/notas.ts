import { prisma } from "@/lib/prisma";
import { type ToolDef, ok, fail, parseDate, fmtDateTime, appUrl } from "./types";

/**
 * O "bloquinho": ideias, notas, lembretes e tarefas pessoais (AssistantNote).
 * Coisas que não são chamado nem tarefa de projeto — só pra não esquecer.
 */

const KINDS = ["IDEA", "NOTE", "REMINDER", "TASK"] as const;
type Kind = (typeof KINDS)[number];
const KIND_LABEL: Record<Kind, string> = { IDEA: "💡 Ideia", NOTE: "📝 Nota", REMINDER: "⏰ Lembrete", TASK: "☑️ Tarefa" };

export const anotar: ToolDef<{ kind?: "IDEA" | "NOTE"; title: string; body?: string; clientCompanyId?: string }> = {
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
    },
    required: ["title"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const kind: Kind = input.kind === "IDEA" ? "IDEA" : "NOTE";
    const n = await prisma.assistantNote.create({
      data: { userId: ctx.userId, companyId: ctx.companyId, kind, title: input.title.trim(), body: input.body?.trim() || null, source: ctx.channel, clientCompanyId: input.clientCompanyId ?? null },
      select: { id: true },
    });
    return ok(`${KIND_LABEL[kind]} guardada: "${input.title.trim()}"`, { data: { id: n.id }, link: appUrl("/assistente?aba=bloquinho") });
  },
};

export const criarLembrete: ToolDef<{ title: string; dueAt: string; body?: string }> = {
  name: "criar_lembrete",
  description:
    "Cria um lembrete com data e hora (ISO 8601 com offset -03:00). Na hora marcada o usuário recebe a mensagem no WhatsApp e no app. Use pra 'me lembra de X às Y'. Se o usuário disser só o dia, assuma 09:00.",
  input_schema: {
    type: "object",
    properties: { title: { type: "string" }, dueAt: { type: "string" }, body: { type: "string" } },
    required: ["title", "dueAt"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const due = parseDate(input.dueAt);
    if (!due) return fail("dueAt inválido.");
    const n = await prisma.assistantNote.create({
      data: { userId: ctx.userId, companyId: ctx.companyId, kind: "REMINDER", title: input.title.trim(), body: input.body?.trim() || null, dueAt: due, source: ctx.channel },
      select: { id: true },
    });
    return ok(`⏰ Lembrete criado: "${input.title.trim()}" em ${fmtDateTime(due)}`, { data: { id: n.id } });
  },
};

export const criarTarefaPessoal: ToolDef<{ title: string; dueAt?: string; body?: string; clientCompanyId?: string }> = {
  name: "criar_tarefa_pessoal",
  description:
    "Cria uma tarefa pessoal rápida (to-do do próprio usuário, fora de projetos e chamados). dueAt opcional (ISO 8601). Aparece na fila do dia. Prefira criar_chamado quando for demanda de cliente ou da equipe, e criar_tarefa_projeto quando pertencer a um projeto.",
  input_schema: {
    type: "object",
    properties: { title: { type: "string" }, dueAt: { type: "string" }, body: { type: "string" }, clientCompanyId: { type: "string" } },
    required: ["title"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const due = input.dueAt ? parseDate(input.dueAt) : null;
    if (input.dueAt && !due) return fail("dueAt inválido.");
    const n = await prisma.assistantNote.create({
      data: { userId: ctx.userId, companyId: ctx.companyId, kind: "TASK", title: input.title.trim(), body: input.body?.trim() || null, dueAt: due, source: ctx.channel, clientCompanyId: input.clientCompanyId ?? null },
      select: { id: true },
    });
    return ok(`☑️ Tarefa pessoal criada: "${input.title.trim()}"${due ? ` · ${fmtDateTime(due)}` : ""}`, { data: { id: n.id } });
  },
};

export const listarAnotacoes: ToolDef<{ kind?: Kind; incluirConcluidas?: boolean; query?: string }> = {
  name: "listar_anotacoes",
  description:
    "Lista o bloquinho do usuário: ideias, notas, lembretes e tarefas pessoais pendentes. Filtre por kind ou trecho de texto. Retorna id de cada item (necessário pra concluir/excluir).",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: [...KINDS] },
      incluirConcluidas: { type: "boolean" },
      query: { type: "string" },
    },
  },
  run: async (input, ctx) => {
    const rows = await prisma.assistantNote.findMany({
      where: {
        userId: ctx.userId,
        ...(input.kind ? { kind: input.kind } : {}),
        ...(input.incluirConcluidas ? {} : { done: false }),
        ...(input.query ? { OR: [{ title: { contains: input.query, mode: "insensitive" } }, { body: { contains: input.query, mode: "insensitive" } }] } : {}),
      },
      orderBy: [{ done: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      take: 30,
      select: { id: true, kind: true, title: true, body: true, dueAt: true, done: true, createdAt: true },
    });
    if (rows.length === 0) return ok("Bloquinho vazio (nada pendente).", { data: [] });
    const lines = rows.map((r) =>
      `- ${KIND_LABEL[r.kind as Kind] ?? r.kind} ${r.done ? "✅ " : ""}"${r.title}"${r.dueAt ? ` · ${fmtDateTime(r.dueAt)}` : ""}${r.body ? ` — ${r.body.slice(0, 80)}` : ""} · id=${r.id}`
    );
    return ok(lines.join("\n"), { data: rows });
  },
};

export const concluirItem: ToolDef<{ id: string }> = {
  name: "concluir_item",
  description: "Marca como concluído um item do bloquinho (tarefa pessoal, lembrete, nota ou ideia) pelo id.",
  input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  mutating: true,
  run: async ({ id }, ctx) => {
    const n = await prisma.assistantNote.findFirst({ where: { id, userId: ctx.userId }, select: { id: true, title: true } });
    if (!n) return fail("Item não encontrado.");
    await prisma.assistantNote.update({ where: { id }, data: { done: true, doneAt: ctx.now } });
    return ok(`✅ Concluído: "${n.title}"`);
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

export const notasTools: ToolDef[] = [anotar, criarLembrete, criarTarefaPessoal, listarAnotacoes, concluirItem, excluirItem];
