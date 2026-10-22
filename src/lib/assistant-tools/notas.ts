import { prisma } from "@/lib/prisma";
import { type ToolDef, ok, fail, parseDate, fmtDateTime, appUrl } from "./types";
import { logNoteEvent, describeEdit } from "@/lib/personal-assistant/note-events";
import { appendToNote, normalizeText } from "@/lib/personal-assistant/dedupe";
import { intakeNote, delegateToTicket } from "@/lib/personal-assistant/intake";

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
// Matriz de Eisenhower
const IMPORTANT_PROP = { type: "boolean", description: "Importante = contribui pro objetivo/cliente/dinheiro (default true). Não importante = pode ser delegado ou eliminado." } as const;
const URGENT_PROP = { type: "boolean", description: "Urgente = precisa de ação nos próximos 1-2 dias ou alguém está esperando (default: true se o prazo for em até 48h)." } as const;
export type Quadrant = "fazer" | "agendar" | "delegar" | "eliminar";
export function quadrantOf(important: boolean, urgent: boolean): Quadrant {
  return important ? (urgent ? "fazer" : "agendar") : (urgent ? "delegar" : "eliminar");
}
const QUAD_ICON: Record<Quadrant, string> = { fazer: "🔥", agendar: "📅", delegar: "👉", eliminar: "🗑️" };
const QUAD_LABEL: Record<Quadrant, string> = { fazer: "Fazer", agendar: "Agendar", delegar: "Delegar", eliminar: "Eliminar" };
function isSoon(d: Date | null | undefined, now: Date): boolean {
  return !!d && d.getTime() - now.getTime() < 48 * 3600_000;
}

/** Entrada única (regras → auto-resolução → mesmo assunto → cria). Ver intake.ts. */
async function createOrAppend(ctx: { userId: string; companyId: string; channel: string; userName: string }, input: {
  kind: Kind; title: string; body?: string | null; dueAt?: Date | null; clientCompanyId?: string | null; tags?: string[]; forcarNovo?: boolean; important?: boolean; urgent?: boolean;
}): Promise<{ created: boolean; id: string; title: string; message: string }> {
  const r = await intakeNote(
    { userId: ctx.userId, companyId: ctx.companyId, userName: ctx.userName, channel: ctx.channel },
    { kind: input.kind, title: input.title, body: input.body, dueAt: input.dueAt, tags: cleanTags(input.tags), clientCompanyId: input.clientCompanyId, important: input.important, urgent: input.urgent, forceNew: input.forcarNovo },
  );
  return { created: r.action === "created", id: r.id, title: r.title, message: r.message };
}

export const anotar: ToolDef<{ kind?: "IDEA" | "NOTE"; title: string; body?: string; clientCompanyId?: string; tags?: string[]; forcarNovo?: boolean; importante?: boolean; urgente?: boolean }> = {
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
      importante: IMPORTANT_PROP,
      urgente: URGENT_PROP,
    },
    required: ["title"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const kind: Kind = input.kind === "IDEA" ? "IDEA" : "NOTE";
    const r = await createOrAppend(ctx, { kind, title: input.title, body: input.body, clientCompanyId: input.clientCompanyId, tags: input.tags, forcarNovo: input.forcarNovo, important: input.importante, urgent: input.urgente ?? false });
    return ok(r.message, { data: { id: r.id, appended: !r.created }, link: appUrl("/assistente?aba=bloquinho") });
  },
};

export const criarLembrete: ToolDef<{ title: string; dueAt: string; body?: string; tags?: string[]; forcarNovo?: boolean; importante?: boolean; urgente?: boolean }> = {
  name: "criar_lembrete",
  description:
    "Cria um lembrete com data e hora (ISO 8601 com offset -03:00). Na hora marcada o usuário recebe a mensagem no WhatsApp e no app. Use pra 'me lembra de X às Y'. Se o usuário disser só o dia, assuma 09:00. Se já existir item aberto do mesmo assunto, acrescenta nele e antecipa o prazo se o novo for antes.",
  input_schema: {
    type: "object",
    properties: { title: { type: "string" }, dueAt: { type: "string" }, body: { type: "string" }, tags: TAGS_PROP, forcarNovo: FORCAR_PROP, importante: IMPORTANT_PROP, urgente: URGENT_PROP },
    required: ["title", "dueAt"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const due = parseDate(input.dueAt);
    if (!due) return fail("dueAt inválido.");
    const r = await createOrAppend(ctx, { kind: "REMINDER", title: input.title, body: input.body, dueAt: due, tags: input.tags, forcarNovo: input.forcarNovo, important: input.importante, urgent: input.urgente });
    return ok(r.message, { data: { id: r.id, appended: !r.created } });
  },
};

export const criarTarefaPessoal: ToolDef<{ title: string; dueAt?: string; body?: string; clientCompanyId?: string; tags?: string[]; forcarNovo?: boolean; importante?: boolean; urgente?: boolean }> = {
  name: "criar_tarefa_pessoal",
  description:
    "Cria uma tarefa pessoal rápida (to-do do próprio usuário, fora de projetos e chamados). dueAt SÓ quando houver prazo real (não invente data); sem prazo ela fica no bloquinho sem entrar em 'Hoje'. Conteúdo pra gravar (reels) = importante, não urgente, sem dueAt (quadrante Agendar). Aparece na fila do dia quando tem prazo. Prefira criar_chamado quando for demanda de cliente ou da equipe, e criar_tarefa_projeto quando pertencer a um projeto. Se já existir item aberto do mesmo assunto, o conteúdo é ACRESCENTADO nele (não duplica).",
  input_schema: {
    type: "object",
    properties: { title: { type: "string" }, dueAt: { type: "string" }, body: { type: "string" }, clientCompanyId: { type: "string" }, tags: TAGS_PROP, forcarNovo: FORCAR_PROP, importante: IMPORTANT_PROP, urgente: URGENT_PROP },
    required: ["title"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const due = input.dueAt ? parseDate(input.dueAt) : null;
    if (input.dueAt && !due) return fail("dueAt inválido.");
    const r = await createOrAppend(ctx, { kind: "TASK", title: input.title, body: input.body, dueAt: due, clientCompanyId: input.clientCompanyId, tags: input.tags, forcarNovo: input.forcarNovo, important: input.importante, urgent: input.urgente });
    return ok(r.message, { data: { id: r.id, appended: !r.created } });
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

export const listarAnotacoes: ToolDef<{ kind?: Kind; incluirConcluidas?: boolean; incluirArquivadas?: boolean; query?: string; tag?: string; quadrante?: Quadrant; origem?: "meu" | "rotinas"; atrasadas?: boolean }> = {
  name: "listar_anotacoes",
  description:
    "Lista o bloquinho do usuário (pendentes, não arquivados). Filtros: kind, trecho de texto, etiqueta, quadrante da matriz de Eisenhower (fazer/agendar/delegar/eliminar), origem ('meu' = anotado pelo usuário no app/WhatsApp; 'rotinas' = veio de rotinas/Claude/webhook), atrasadas (prazo vencido). Retorna id de cada item.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: [...KINDS] },
      incluirConcluidas: { type: "boolean" },
      incluirArquivadas: { type: "boolean" },
      query: { type: "string" },
      tag: { type: "string", description: "Filtra por etiqueta (ex.: financeiro)" },
      quadrante: { type: "string", enum: ["fazer", "agendar", "delegar", "eliminar"] },
      origem: { type: "string", enum: ["meu", "rotinas"] },
      atrasadas: { type: "boolean", description: "Só itens com prazo vencido" },
    },
  },
  run: async (input, ctx) => {
    const rows = await prisma.assistantNote.findMany({
      where: {
        userId: ctx.userId,
        ...(input.kind ? { kind: input.kind } : {}),
        ...(input.incluirConcluidas ? {} : { done: false }),
        ...(input.incluirArquivadas ? {} : { archivedAt: null }),
        ...(input.query ? { OR: [{ title: { contains: input.query, mode: "insensitive" } }, { body: { contains: input.query, mode: "insensitive" } }] } : {}),
        ...(input.tag ? { tags: { has: input.tag.trim().toLowerCase() } } : {}),
        ...(input.quadrante ? { important: input.quadrante === "fazer" || input.quadrante === "agendar", urgent: input.quadrante === "fazer" || input.quadrante === "delegar" } : {}),
        ...(input.origem === "meu" ? { source: { in: ["APP", "WHATSAPP", "IPHONE"] } } : input.origem === "rotinas" ? { source: { in: ["MCP", "WEBHOOK"] } } : {}),
        ...(input.atrasadas ? { dueAt: { lt: ctx.now } } : {}),
      },
      orderBy: [{ done: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 60,
      select: { id: true, kind: true, title: true, body: true, dueAt: true, done: true, createdAt: true, tags: true, doneNote: true, important: true, urgent: true, source: true },
    });
    if (rows.length === 0) return ok("Nada encontrado no bloquinho.", { data: [] });
    const lines = rows.map((r) =>
      `- ${QUAD_ICON[quadrantOf(r.important, r.urgent)]} ${KIND_LABEL[r.kind as Kind] ?? r.kind} ${r.done ? "✅ " : ""}"${r.title}"${r.dueAt ? ` · ${fmtDateTime(r.dueAt)}${r.dueAt < ctx.now && !r.done ? " ⚠️" : ""}` : ""}${r.body ? ` — ${r.body.slice(0, 60)}` : ""}${r.tags.length ? ` [${r.tags.join(", ")}]` : ""}${r.source === "MCP" || r.source === "WEBHOOK" ? " (rotina)" : ""}${r.done && r.doneNote ? ` (feito: ${r.doneNote.slice(0, 60)})` : ""} · id=${r.id}`
    );
    return ok(`${rows.length} item(ns) (🔥 fazer · 📅 agendar · 👉 delegar · 🗑️ eliminar):\n${lines.join("\n")}`, { data: rows });
  },
};

export const editarItem: ToolDef<{ id: string; title?: string; body?: string; dueAt?: string | null; kind?: Kind; tags?: string[]; importante?: boolean; urgente?: boolean }> = {
  name: "editar_item",
  description: "Edita um item do bloquinho pelo id: título, texto, data (dueAt ISO ou null pra remover), tipo, etiquetas e classificação na matriz (importante/urgente). Use listar_anotacoes pra achar o id.",
  input_schema: {
    type: "object",
    properties: { id: { type: "string" }, title: { type: "string" }, body: { type: "string" }, dueAt: { type: ["string", "null"] }, kind: { type: "string", enum: [...KINDS] }, tags: TAGS_PROP, importante: IMPORTANT_PROP, urgente: URGENT_PROP },
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
    if (typeof input.importante === "boolean") data.important = input.importante;
    if (typeof input.urgente === "boolean") data.urgent = input.urgente;
    if (input.dueAt === null) data.dueAt = null;
    else if (typeof input.dueAt === "string") { const d = parseDate(input.dueAt); if (!d) return fail("dueAt inválido."); data.dueAt = d; data.remindedAt = null; }
    const u = await prisma.assistantNote.update({ where: { id: n.id }, data, select: { title: true, tags: true } });
    await logNoteEvent(n.id, "EDITED", ctx.channel, describeEdit(data));
    return ok(`✏️ Atualizado: "${u.title}"${u.tags.length ? ` [${u.tags.join(", ")}]` : ""}`);
  },
};

export const adiarItens: ToolDef<{ ids: string[]; dueAt: string | null }> = {
  name: "adiar_itens",
  description: "Adia um ou vários itens do bloquinho pra uma nova data (ISO 8601) ou tira o prazo (dueAt null → sai do 'Hoje', fica só no bloquinho). Use pra 'adia tudo de reels pra sexta', 'tira o prazo disso'.",
  input_schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } }, dueAt: { type: ["string", "null"] } }, required: ["ids", "dueAt"] },
  mutating: true,
  run: async ({ ids, dueAt }, ctx) => {
    const d = dueAt === null ? null : parseDate(dueAt);
    if (dueAt !== null && !d) return fail("dueAt inválido.");
    const rows = await prisma.assistantNote.findMany({ where: { id: { in: ids ?? [] }, userId: ctx.userId }, select: { id: true, title: true } });
    if (rows.length === 0) return fail("Nenhum item encontrado.");
    await prisma.assistantNote.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { dueAt: d, remindedAt: null } });
    for (const r of rows) await logNoteEvent(r.id, "EDITED", ctx.channel, d ? `adiado para ${fmtDateTime(d)}` : "prazo removido");
    return ok(`${d ? `⏩ Adiado(s) para ${fmtDateTime(d)}` : "🗓️ Prazo removido"}: ${rows.map((r) => `"${r.title}"`).join(", ")}`);
  },
};

export const arquivarItens: ToolDef<{ ids: string[]; desarquivar?: boolean }> = {
  name: "arquivar_itens",
  description: "Arquiva itens do bloquinho (somem da lista e da fila, mas ficam guardados e pesquisáveis). Pra ideias/notas/referências que não viram ação agora. desarquivar=true reverte.",
  input_schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } }, desarquivar: { type: "boolean" } }, required: ["ids"] },
  mutating: true,
  run: async ({ ids, desarquivar }, ctx) => {
    const rows = await prisma.assistantNote.findMany({ where: { id: { in: ids ?? [] }, userId: ctx.userId }, select: { id: true, title: true } });
    if (rows.length === 0) return fail("Nenhum item encontrado.");
    await prisma.assistantNote.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { archivedAt: desarquivar ? null : ctx.now } });
    for (const r of rows) await logNoteEvent(r.id, "EDITED", ctx.channel, desarquivar ? "desarquivado" : "arquivado");
    return ok(`${desarquivar ? "📂 Desarquivado(s)" : "🗄️ Arquivado(s)"}: ${rows.map((r) => `"${r.title}"`).join(", ")}`);
  },
};

export const delegarItem: ToolDef<{ id: string; assigneeId?: string; assigneeName?: string; dueDate?: string; instrucoes?: string }> = {
  name: "delegar_item",
  description: "Delega um item do bloquinho: cria um chamado INTERNO no GoHub atribuído ao responsável (assigneeId de listar_usuarios, ou assigneeName pra eu achar) com o conteúdo do item, e conclui o item como 'delegado'. dueDate opcional (ISO 8601; default fim do próximo dia útil). Quadrante 'delegar' da matriz.",
  input_schema: { type: "object", properties: { id: { type: "string" }, assigneeId: { type: "string" }, assigneeName: { type: "string" }, dueDate: { type: "string" }, instrucoes: { type: "string", description: "O que o responsável deve fazer, se diferente do item" } }, required: ["id"] },
  mutating: true,
  run: async (input, ctx) => {
    const n = await prisma.assistantNote.findFirst({ where: { id: input.id, userId: ctx.userId }, select: { id: true, title: true, body: true, dueAt: true } });
    if (!n) return fail("Item não encontrado.");
    let assignee = input.assigneeId ? await prisma.user.findFirst({ where: { id: input.assigneeId, companyId: ctx.companyId }, select: { id: true, name: true } }) : null;
    if (!assignee && input.assigneeName) {
      assignee = await prisma.user.findFirst({ where: { companyId: ctx.companyId, role: { not: "SUPER_ADMIN" }, name: { contains: input.assigneeName.trim(), mode: "insensitive" } }, select: { id: true, name: true } });
    }
    if (!assignee) return fail("Responsável não encontrado. Use listar_usuarios e informe assigneeId.");
    const due = input.dueDate ? parseDate(input.dueDate) : n.dueAt;
    const ticketId = await delegateToTicket({ companyId: ctx.companyId, userId: ctx.userId, userName: ctx.userName, role: ctx.role }, { title: n.title, body: n.body, dueAt: due, instructions: input.instrucoes }, assignee.id);
    const doneNote = `Delegado para ${assignee.name} — chamado ${appUrl(`/chamados/${ticketId}`)}`;
    await prisma.assistantNote.update({ where: { id: n.id }, data: { done: true, doneAt: ctx.now, doneNote, important: false, urgent: true } });
    await logNoteEvent(n.id, "DONE", ctx.channel, doneNote);
    return ok(`👉 Delegado para ${assignee.name}: chamado interno "${n.title}"`, { data: { ticketId, assigneeId: assignee.id }, link: appUrl(`/chamados/${ticketId}`) });
  },
};

export const criarRegra: ToolDef<{ padrao: string; acao: "DONE" | "ARCHIVE" | "DELEGATE" | "CLASSIFY" | "INFO"; assigneeId?: string; assigneeName?: string; importante?: boolean; urgente?: boolean; tags?: string[]; observacao?: string }> = {
  name: "criar_regra",
  description:
    "Regra 'sempre que…': todo item que CHEGAR (rotina, e-mail, webhook, anotação) cujo título/texto OU etiqueta contenha o padrão já entra tratado. acao: INFO (só avisar: vira lembrete sem prazo, só pra consulta — vale apenas pro que vem de rotinas; ex.: 'financeiro' quando outra pessoa já cuida), DONE (entra concluído — avisos que não exigem ação), ARCHIVE (entra arquivado), DELEGATE (vira chamado interno pro responsável; informe assigneeId/assigneeName), CLASSIFY (só define importante/urgente/etiquetas). Ex.: 'sempre que chegar fatura da Opção Telecom, delega pra Kelly'.",
  input_schema: {
    type: "object",
    properties: {
      padrao: { type: "string", description: "Trecho que identifica o assunto, ex.: 'opção telecom', 'backup wordpress', 'fatura hostmach'" },
      acao: { type: "string", enum: ["DONE", "ARCHIVE", "DELEGATE", "CLASSIFY", "INFO"] },
      assigneeId: { type: "string" }, assigneeName: { type: "string" },
      importante: IMPORTANT_PROP, urgente: URGENT_PROP, tags: TAGS_PROP,
      observacao: { type: "string" },
    },
    required: ["padrao", "acao"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const pattern = normalizeText(input.padrao);
    if (pattern.length < 3) return fail("Padrão muito curto.");
    let assigneeId: string | null = null;
    if (input.acao === "DELEGATE") {
      const a = input.assigneeId
        ? await prisma.user.findFirst({ where: { id: input.assigneeId, companyId: ctx.companyId }, select: { id: true, name: true } })
        : input.assigneeName ? await prisma.user.findFirst({ where: { companyId: ctx.companyId, role: { not: "SUPER_ADMIN" }, name: { contains: input.assigneeName.trim(), mode: "insensitive" } }, select: { id: true, name: true } }) : null;
      if (!a) return fail("Responsável não encontrado (use listar_usuarios).");
      assigneeId = a.id;
    }
    const r = await prisma.assistantRule.create({
      data: { userId: ctx.userId, pattern, action: input.acao, assigneeId, important: typeof input.importante === "boolean" ? input.importante : null, urgent: typeof input.urgente === "boolean" ? input.urgente : null, tags: cleanTags(input.tags), note: input.observacao?.trim() || null },
      select: { id: true },
    });
    const label = { DONE: "entra concluído", ARCHIVE: "entra arquivado", DELEGATE: "vira chamado interno delegado", CLASSIFY: "só classifica", INFO: "vira só aviso (lembrete sem prazo, quando vier de rotina)" }[input.acao];
    return ok(`📏 Regra criada: sempre que chegar algo com "${input.padrao}", ${label}. (id=${r.id})`);
  },
};

export const listarRegras: ToolDef<Record<string, never>> = {
  name: "listar_regras",
  description: "Lista as regras 'sempre que…' do usuário, com quantas vezes cada uma já foi aplicada.",
  input_schema: { type: "object", properties: {} },
  run: async (_i, ctx) => {
    const rows = await prisma.assistantRule.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: "desc" } });
    if (!rows.length) return ok("Nenhuma regra.", { data: [] });
    return ok(rows.map((r) => `- "${r.pattern}" → ${r.action}${r.assigneeId ? ` (resp. ${r.assigneeId})` : ""}${r.tags.length ? ` [${r.tags.join(", ")}]` : ""} · aplicada ${r.hits}x${r.note ? ` · ${r.note}` : ""} · id=${r.id}`).join("\n"), { data: rows });
  },
};

export const excluirRegra: ToolDef<{ id: string }> = {
  name: "excluir_regra",
  description: "Remove uma regra 'sempre que…' pelo id (listar_regras).",
  input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  mutating: true,
  run: async ({ id }, ctx) => {
    const n = await prisma.assistantRule.deleteMany({ where: { id, userId: ctx.userId } });
    return n.count ? ok("Regra removida.") : fail("Regra não encontrada.");
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

export const notasTools: ToolDef[] = [anotar, criarLembrete, criarTarefaPessoal, listarAnotacoes, editarItem, acrescentarAoItem, adiarItens, arquivarItens, delegarItem, criarRegra, listarRegras, excluirRegra, concluirItem, reabrirItem, excluirItem];
