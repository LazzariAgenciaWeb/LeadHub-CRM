import { prisma } from "@/lib/prisma";
import { appUrl, fmtDateTime } from "@/lib/assistant-tools/types";
import { logNoteEvent } from "./note-events";
import { findSimilarOpenNote, appendToNote, normalizeText } from "./dedupe";

/**
 * Entrada ÚNICA de itens no bloquinho (chat, WhatsApp, Claude via MCP,
 * webhook). Na ordem:
 *   1. Regras "sempre que…" do usuário (delegar / arquivar / concluir / classificar)
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
}
export type IntakeResult =
  | { action: "created"; id: string; title: string; message: string }
  | { action: "appended"; id: string; title: string; message: string }
  | { action: "resolved"; id: string; title: string; message: string }
  | { action: "archived"; id: string; title: string; message: string }
  | { action: "delegated"; id: string; title: string; message: string; ticketId: string }
  | { action: "done"; id: string; title: string; message: string };

const RESOLVE_RE = /\b(pag[oa]s?|quitad[oa]s?|confirmad[oa]s?|resolvid[oa]s?|renovad[oa]s?|conclu[ií]d[oa]s?|liberad[oa]s?|aprovad[oa]s?|cancelad[oa]s?|regularizad[oa]s?|religad[oa]s?|reativad[oa]s?|comprovante)\b/;
const ARRIVE_RE = /\b(chegou|nova fatura|fatura recebida|vence|vencimento|pendente|aguardando|alerta|aviso|lembrete)\b/;

export async function intakeNote(ctx: IntakeCtx, draft: IntakeDraft): Promise<IntakeResult> {
  const title = draft.title.trim();
  const body = draft.body?.trim() || null;
  const tags = [...new Set((draft.tags ?? []).map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean))].slice(0, 6);
  const text = normalizeText(`${title} ${body ?? ""}`);
  const now = new Date();
  const link = appUrl("/assistente?aba=bloquinho");

  // ── 1. Regras do usuário ──────────────────────────────────────────────────
  const rules = await prisma.assistantRule.findMany({ where: { userId: ctx.userId } });
  const rule = rules.find((r) => r.pattern && text.includes(r.pattern));
  let important = draft.important ?? true;
  let urgent = draft.urgent ?? (!!draft.dueAt && draft.dueAt.getTime() - now.getTime() < 48 * 3600_000);
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
    data: { userId: ctx.userId, companyId: ctx.companyId, kind: draft.kind, title, body, dueAt: draft.dueAt ?? null, tags, source: ctx.channel, clientCompanyId: draft.clientCompanyId ?? null, important, urgent },
    select: { id: true },
  });
  await logNoteEvent(n.id, "CREATED", ctx.channel, ctx.sourceLabel ? `rotina: ${ctx.sourceLabel}` : null);
  const label = draft.kind === "IDEA" ? "💡 Ideia guardada" : draft.kind === "NOTE" ? "📝 Nota guardada" : draft.kind === "REMINDER" ? "⏰ Lembrete criado" : "☑️ Tarefa criada";
  return { action: "created", id: n.id, title, message: `${label}: "${title}"${draft.dueAt ? ` · ${fmtDateTime(draft.dueAt)}` : ""}${rule ? ` (regra "${rule.pattern}" aplicada)` : ""} — ${link}` };
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
