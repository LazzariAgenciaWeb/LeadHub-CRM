import { prisma } from "@/lib/prisma";
import { appUrl, fmtDateTime } from "@/lib/assistant-tools/types";
import { logNoteEvent } from "./note-events";
import { findSimilarOpenNote, appendToNote, normalizeText } from "./dedupe";
import { LINKABLE_KINDS, extractTaskIds, stripTaskLinkLines, validTaskIds } from "./task-links";

/**
 * Entrada ÚNICA de itens no bloquinho (chat, WhatsApp, Claude via MCP,
 * webhook). Na ordem:
 *   1. Regras "sempre que…" do usuário (delegar / arquivar / concluir / classificar / banco de ideias)
 *   2. Auto-resolução: "fatura paga", "renovado", "confirmado"… sobre um
 *      assunto já aberto → conclui o item antigo com essa informação
 *   3. Mesmo assunto aberto → acrescenta (não duplica)
 *   4. Cria
 */
export type Kind = "IDEA" | "NOTE" | "REMINDER" | "TASK";

export interface IntakeCtx { userId: string; companyId: string | null; userName: string; channel: string; sourceLabel?: string }
export interface IntakeDraft {
  kind: Kind; title: string; body?: string | null; dueAt?: Date | null; tags?: string[]; clientCompanyId?: string | null;
  important?: boolean; urgent?: boolean; forceNew?: boolean;
  /** Tarefas de projeto que o item acompanha (ver task-links.ts). Sem isso, extrai do link no texto. */
  projectTaskIds?: string[];
}
export type IntakeResult =
  | { action: "created"; id: string; title: string; message: string }
  | { action: "appended"; id: string; title: string; message: string }
  | { action: "resolved"; id: string; title: string; message: string }
  | { action: "archived"; id: string; title: string; message: string }
  | { action: "delegated"; id: string; title: string; message: string; ticketId: string }
  | { action: "done"; id: string; title: string; message: string };

const RESOLVE_RE = /\b(pag[oa]s?|quitad[oa]s?|confirmad[oa]s?|resolvid[oa]s?|renovad[oa]s?|conclu[ií]d[oa]s?|liberad[oa]s?|aprovad[oa]s?|cancelad[oa]s?|regularizad[oa]s?|religad[oa]s?|reativad[oa]s?|comprovante|agendad[oa]s?|programad[oa]s?|efetuad[oa]s?|realizad[oa]s?|baixad[oa]s?|feito|quitacao)\b/;
const ARRIVE_RE = /\b(chegou|nova fatura|fatura recebida|vence|vencimento|pendente|aguardando|alerta|aviso|lembrete)\b/;

export async function intakeNote(ctx: IntakeCtx, draftIn: IntakeDraft): Promise<IntakeResult> {
  let draft = draftIn;
  const title = draft.title.trim();
  let body = draft.body?.trim() || null;
  // Vínculo com tarefa de projeto: explícito ou pelo link /projetos/…?tarefa=… no texto.
  let projectTaskIds: string[] = [];
  if (LINKABLE_KINDS.has(draft.kind)) {
    const asked = draft.projectTaskIds?.length ? draft.projectTaskIds : extractTaskIds(`${title}\n${body ?? ""}`);
    projectTaskIds = await validTaskIds([...new Set(asked)].slice(0, 10), ctx.companyId);
    if (projectTaskIds.length) body = stripTaskLinkLines(body);
  }
  const tags = [...new Set((draft.tags ?? []).map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean))].slice(0, 6);
  const text = normalizeText(`${title} ${body ?? ""}`);
  const now = new Date();
  const link = appUrl("/assistente?aba=bloquinho");

  // ── 1. Regras do usuário ──────────────────────────────────────────────────
  // Casa no texto OU numa etiqueta (ex.: regra "financeiro" pega tudo com #financeiro).
  // INFO ("só avisar") vale só pro que vem de rotinas (MCP/webhook): o que o
  // usuário anota com a mesma etiqueta continua sendo tarefa dele.
  const fromRoutine = ctx.channel === "MCP" || ctx.channel === "WEBHOOK";
  const rules = await prisma.assistantRule.findMany({ where: { userId: ctx.userId } });
  const rule = rules.find((r) => r.pattern && (text.includes(r.pattern) || tags.includes(r.pattern)) && (r.action !== "INFO" || fromRoutine));
  let important = draft.important ?? true;
  let urgent = draft.urgent ?? (!!draft.dueAt && draft.dueAt.getTime() - now.getTime() < 48 * 3600_000);
  if (rule?.action === "INFO") {
    // Aviso: vira lembrete SEM prazo (fica no bloquinho pra consulta, não entra
    // na fila nem cobra ação). Segue o fluxo normal (acrescenta/resolve/cria).
    draft = { ...draft, kind: "REMINDER", dueAt: null };
    urgent = false;
    if (!tags.includes("aviso")) tags.push("aviso");
  }
  if (rule?.action === "IDEA") {
    // Banco de ideias (ex.: roteiros de reels): fica guardado pra quando houver
    // tempo — sem prazo, fora da fila, sem alarme e fora dos Lembretes do iPhone.
    draft = { ...draft, kind: "IDEA", dueAt: null };
    important = false;
    urgent = false;
  }
  if (rule) {
    await prisma.assistantRule.update({ where: { id: rule.id }, data: { hits: { increment: 1 }, lastHitAt: now } }).catch(() => {});
    if (rule.important !== null) important = rule.important;
    if (rule.urgent !== null) urgent = rule.urgent;
    for (const t of rule.tags) if (!tags.includes(t)) tags.push(t);

    if (rule.action === "ARCHIVE" || rule.action === "DONE") {
      // Entra já tratado — fica registrado (pesquisável), mas não ocupa espaço.
      const n = await prisma.assistantNote.create({
        data: { userId: ctx.userId, companyId: ctx.companyId, kind: draft.kind, title, body, dueAt: draft.dueAt ?? null, tags, source: ctx.channel, clientCompanyId: draft.clientCompanyId ?? null, important, urgent,
          ...(rule.action === "ARCHIVE" ? { archivedAt: now } : { done: true, doneAt: now, doneNote: `Regra: ${rule.note ?? rule.pattern}` }) },
        select: { id: true },
      });
      await logNoteEvent(n.id, "CREATED", ctx.channel, `regra "${rule.pattern}" → ${rule.action === "ARCHIVE" ? "arquivado" : "concluído"}`);
      return rule.action === "ARCHIVE"
        ? { action: "archived", id: n.id, title, message: `🗄️ "${title}" arquivado pela regra "${rule.pattern}".` }
        : { action: "done", id: n.id, title, message: `✅ "${title}" concluído pela regra "${rule.pattern}".` };
    }
    if (rule.action === "DELEGATE" && rule.assigneeId && ctx.companyId) {
      const assignee = await prisma.user.findFirst({ where: { id: rule.assigneeId, companyId: ctx.companyId }, select: { id: true, name: true } });
      if (assignee) {
        const n = await prisma.assistantNote.create({
          data: { userId: ctx.userId, companyId: ctx.companyId, kind: draft.kind, title, body, dueAt: draft.dueAt ?? null, tags, source: ctx.channel, clientCompanyId: draft.clientCompanyId ?? null, important: false, urgent: true },
          select: { id: true },
        });
        const ticketId = await delegateToTicket({ companyId: ctx.companyId, userId: ctx.userId, userName: ctx.userName, role: "ADMIN" }, { title, body, dueAt: draft.dueAt ?? null }, assignee.id);
        const doneNote = `Delegado para ${assignee.name} pela regra "${rule.pattern}" — chamado ${appUrl(`/chamados/${ticketId}`)}`;
        await prisma.assistantNote.update({ where: { id: n.id }, data: { done: true, doneAt: now, doneNote } });
        await logNoteEvent(n.id, "DONE", ctx.channel, doneNote);
        return { action: "delegated", id: n.id, title, ticketId, message: `👉 "${title}" delegado para ${assignee.name} (chamado interno), pela regra "${rule.pattern}".` };
      }
    }
    // CLASSIFY: segue o fluxo normal com importante/urgente/tags já definidos.
  }

  // ── 2 e 3. Assunto já aberto? ─────────────────────────────────────────────
  // Mesma tarefa de projeto já acompanhada por um item aberto → acrescenta nele.
  if (!draft.forceNew && projectTaskIds.length) {
    const same = await prisma.assistantNote.findFirst({
      where: { userId: ctx.userId, done: false, archivedAt: null, projectTaskIds: { hasSome: projectTaskIds } },
      select: { id: true, title: true, projectTaskIds: true },
    });
    if (same) {
      await appendToNote(same.id, { title, body, tags, dueAt: draft.dueAt ?? null, source: ctx.channel, sourceLabel: ctx.sourceLabel });
      const merged = [...new Set([...same.projectTaskIds, ...projectTaskIds])];
      if (merged.length !== same.projectTaskIds.length) await prisma.assistantNote.update({ where: { id: same.id }, data: { projectTaskIds: merged } });
      return { action: "appended", id: same.id, title: same.title, message: `📎 Acrescentado ao item que já acompanha essa tarefa: "${same.title}".` };
    }
  }
  if (!draft.forceNew) {
    const similar = await findSimilarOpenNote(ctx.userId, title, { body, clientCompanyId: draft.clientCompanyId ?? null, kind: draft.kind });
    if (similar) {
      const newIsResolution = RESOLVE_RE.test(text) && !ARRIVE_RE.test(normalizeText(title));
      const oldWasPending = !RESOLVE_RE.test(normalizeText(similar.title));
      if (newIsResolution && oldWasPending) {
        const doneNote = `${title}${body ? `\n${body}` : ""}`.slice(0, 2000);
        await prisma.assistantNote.update({ where: { id: similar.id }, data: { done: true, doneAt: now, doneNote } });
        await logNoteEvent(similar.id, "DONE", ctx.channel, `resolvido automaticamente: ${title}`);
        return { action: "resolved", id: similar.id, title: similar.title, message: `✅ "${similar.title}" concluído: ${title}` };
      }
      await appendToNote(similar.id, { title, body, tags, dueAt: draft.dueAt ?? null, source: ctx.channel, sourceLabel: ctx.sourceLabel });
      if (draft.important !== undefined || draft.urgent !== undefined || rule) {
        await prisma.assistantNote.update({ where: { id: similar.id }, data: { important, urgent: urgent || similar.dueAt != null && similar.dueAt < now } }).catch(() => {});
      }
      return { action: "appended", id: similar.id, title: similar.title, message: `📎 Acrescentado ao item existente "${similar.title}" (mesmo assunto).` };
    }
  }

  // ── 4. Cria ───────────────────────────────────────────────────────────────
  const n = await prisma.assistantNote.create({
    data: { userId: ctx.userId, companyId: ctx.companyId, kind: draft.kind, title, body, dueAt: draft.dueAt ?? null, tags, source: ctx.channel, clientCompanyId: draft.clientCompanyId ?? null, important, urgent, projectTaskIds: LINKABLE_KINDS.has(draft.kind) ? projectTaskIds : [] },
    select: { id: true },
  });
  await logNoteEvent(n.id, "CREATED", ctx.channel, ctx.sourceLabel ? `rotina: ${ctx.sourceLabel}` : null);
  const label = draft.kind === "IDEA" ? "💡 Ideia guardada" : draft.kind === "NOTE" ? "📝 Nota guardada" : draft.kind === "REMINDER" ? "⏰ Lembrete criado" : "☑️ Tarefa criada";
  return { action: "created", id: n.id, title, message: `${label}: "${title}"${draft.dueAt ? ` · ${fmtDateTime(draft.dueAt)}` : ""}${rule ? ` (regra "${rule.pattern}" aplicada)` : ""} — ${link}` };
}

/**
 * Delega um item: chamado interno pro responsável e o item fica no quadrante
 * Delegar pra acompanhar (não conclui — fecha sozinho quando o chamado fechar,
 * ver task-links.ts).
 */
export async function delegateNote(
  actor: { companyId: string; userId: string; userName: string; role: string },
  note: { id: string; title: string; body: string | null; dueAt: Date | null },
  assignee: { id: string; name: string },
  opts: { dueAt?: Date | null; instructions?: string | null; source: string },
): Promise<{ ticketId: string; url: string }> {
  const ticketId = await delegateToTicket(actor, { title: note.title, body: note.body, dueAt: opts.dueAt ?? note.dueAt, instructions: opts.instructions ?? null }, assignee.id);
  const url = appUrl(`/chamados/${ticketId}`);
  await prisma.assistantNote.update({
    where: { id: note.id },
    data: { important: false, urgent: true, delegatedTicketId: ticketId, delegatedToName: assignee.name, delegatedAt: new Date() },
  });
  await logNoteEvent(note.id, "DELEGATED", opts.source, `para ${assignee.name} — chamado ${url}`);
  return { ticketId, url };
}

/** Cria o chamado interno de uma delegação (usado pela regra e pela tool delegar_item). */
export async function delegateToTicket(
  actor: { companyId: string; userId: string; userName: string; role: string },
  item: { title: string; body: string | null; dueAt: Date | null; instructions?: string | null },
  assigneeId: string,
): Promise<string> {
  const { loadCompanyHours, clampDueDateToBusinessHours } = await import("@/lib/business-hours");
  let due = item.dueAt;
  if (!due) { due = new Date(); due.setDate(due.getDate() + (due.getDay() === 5 ? 3 : due.getDay() === 6 ? 2 : 1)); due.setHours(18, 0, 0, 0); }
  const dueFinal = clampDueDateToBusinessHours(due, await loadCompanyHours(actor.companyId));
  const description = [item.instructions?.trim(), item.body?.trim(), `(delegado por ${actor.userName} a partir do bloquinho)`].filter(Boolean).join("\n\n");
  const t = await prisma.ticket.create({
    data: {
      title: item.title, description, priority: "MEDIUM", companyId: actor.companyId, createdById: actor.userId, type: "INTERNAL",
      dueDate: dueFinal, assigneeId,
      messages: { create: { body: description, authorName: actor.userName, authorRole: actor.role, isInternal: false, source: "LEADHUB" } },
    },
    select: { id: true },
  });
  return t.id;
}
