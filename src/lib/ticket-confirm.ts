import { prisma } from "./prisma";
import { loadCompanyHours, SYSTEM_TIMEZONE } from "./business-hours";
import { loadTicketStages } from "./ticket-stages";
import { getClickupSettings, addCommentToClickupTask } from "./clickup";
import { sendPushToUser } from "./push";
import { CONFIRM_BUSINESS_DAYS, addBusinessDays } from "./ticket-confirm-view";

export { CONFIRM_BUSINESS_DAYS, confirmState, untilText, addBusinessDays } from "./ticket-confirm-view";

/**
 * Confirmação do chamado pelo cliente — parte do servidor (a regra pura mora
 * em ticket-confirm-view).
 *
 *   Resolvido (equipe) ──► cliente confirma no link ──► Fechado, "confirmado por Ana"
 *                      └─► 3 dias úteis sem resposta ──► Fechado automático (cron)
 *                      └─► cliente escreve no link ───► reabre (rota /api/acompanhar)
 *
 * Depois de fechado, o cliente pode dar nota de 1 a 5 ao atendimento (fica no
 * chamado, só a equipe vê) e vê o botão de avaliar a agência no Google.
 */

/** Prazo pro cliente confirmar: +3 dias úteis no horário de atendimento da agência. */
export async function confirmDeadline(companyId: string, from: Date = new Date()): Promise<Date> {
  const hours = await loadCompanyHours(companyId);
  const openDays = hours.filter((d) => d.isOpen).map((d) => d.dayOfWeek);
  return addBusinessDays(from, CONFIRM_BUSINESS_DAYS, openDays, SYSTEM_TIMEZONE);
}

/** Coluna final do kanban pra chamado fechado ("Fechado" nas etapas padrão). */
async function closedStage(companyId: string): Promise<string | undefined> {
  const finals = (await loadTicketStages(companyId)).filter((s) => s.isFinal);
  return finals.length ? finals[finals.length - 1].name : undefined;
}

type TicketRef = { id: string; companyId: string; title: string; clickupTaskId: string | null; assigneeId: string | null; createdById: string | null };

async function tellTeam(t: TicketRef, push: { title: string; body: string }, clickup: string) {
  const notify = t.assigneeId ?? t.createdById;
  if (notify) {
    void sendPushToUser(notify, { ...push, url: `/chamados/${t.id}`, tag: `ticket-${t.id}` }, "newMessage").catch(() => {});
  }
  if (t.clickupTaskId) {
    try {
      const settings = await getClickupSettings(t.companyId);
      if (settings?.apiToken) await addCommentToClickupTask({ apiToken: settings.apiToken, taskId: t.clickupTaskId, comment: clickup });
    } catch { /* best-effort */ }
  }
}

/** Cliente confirmou pelo link que ficou resolvido. */
export async function confirmTicket(t: TicketRef & { status: string }, name: string):
  Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (t.status === "CLOSED") return { ok: true }; // já fechado (cron ou outra pessoa): nada a fazer
  if (t.status !== "RESOLVED") return { ok: false, status: 409, error: "Este chamado foi reaberto e ainda está em atendimento." };

  const now = new Date();
  const stage = await closedStage(t.companyId);
  // Claim pelo status: dois cliques (ou cliente + cron) não gravam duas vezes.
  const r = await prisma.ticket.updateMany({
    where: { id: t.id, status: "RESOLVED" },
    data: {
      status: "CLOSED", confirmedAt: now, confirmedByName: name, confirmDueAt: null,
      ...(stage ? { ticketStage: stage } : {}),
    },
  });
  if (!r.count) return { ok: true };

  await prisma.activity.create({
    data: {
      type: "STATUS_CHANGED",
      body: `${name} (cliente) confirmou que o chamado foi resolvido`,
      meta: { from: "RESOLVED", to: "CLOSED", channel: "acompanhar", confirmed: true },
      authorName: name, ticketId: t.id, companyId: t.companyId,
    },
  }).catch(() => {});
  await tellTeam(t, { title: `✅ ${name} confirmou a solução`, body: t.title }, `✅ Cliente — ${name} confirmou que o chamado foi resolvido.`);
  return { ok: true };
}

/** Nota do atendimento (1–5) + comentário. Pode trocar a nota depois. */
export async function rateTicket(t: TicketRef & { status: string }, name: string, rating: number, comment: string):
  Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (t.status !== "CLOSED") return { ok: false, status: 409, error: "Dá pra avaliar depois que o chamado é encerrado." };
  const nota = Math.round(rating);
  if (!(nota >= 1 && nota <= 5)) return { ok: false, status: 400, error: "Escolha de 1 a 5 estrelas." };

  await prisma.ticket.update({
    where: { id: t.id },
    data:  { rating: nota, ratingComment: comment || null, ratedAt: new Date(), ratedByName: name },
  });
  const stars = "★".repeat(nota) + "☆".repeat(5 - nota);
  await prisma.activity.create({
    data: {
      type: "VALUE_CHANGED",
      body: `${name} avaliou o atendimento: ${stars}${comment ? ` — “${comment.slice(0, 300)}”` : ""}`,
      meta: { field: "rating", to: nota },
      authorName: name, ticketId: t.id, companyId: t.companyId,
    },
  }).catch(() => {});
  await tellTeam(
    t,
    { title: `${nota <= 3 ? "⚠️" : "⭐"} Avaliação ${nota}/5 de ${name}`, body: comment ? comment.slice(0, 120) : t.title },
    `⭐ Cliente — ${name} avaliou o atendimento: ${stars}${comment ? `\n\n${comment}` : ""}`,
  );
  return { ok: true };
}

/**
 * Cron: fecha os chamados resolvidos cujo prazo de confirmação passou.
 * Fica registrado como fechamento automático — a equipe vê a diferença.
 */
export async function autoCloseExpired(now: Date = new Date()): Promise<number> {
  const due = await prisma.ticket.findMany({
    where:  { status: "RESOLVED", confirmDueAt: { lte: now } },
    select: { id: true, companyId: true },
    take:   500,
  });
  const stages = new Map<string, string | undefined>();
  let closed = 0;
  for (const t of due) {
    if (!stages.has(t.companyId)) stages.set(t.companyId, await closedStage(t.companyId));
    const stage = stages.get(t.companyId);
    const r = await prisma.ticket.updateMany({
      where: { id: t.id, status: "RESOLVED", confirmDueAt: { lte: now } },
      data:  { status: "CLOSED", autoClosedAt: now, confirmDueAt: null, ...(stage ? { ticketStage: stage } : {}) },
    });
    if (!r.count) continue;
    closed++;
    await prisma.activity.create({
      data: {
        type: "STATUS_CHANGED",
        body: `Fechado automaticamente: o cliente não respondeu em ${CONFIRM_BUSINESS_DAYS} dias úteis`,
        meta: { from: "RESOLVED", to: "CLOSED", auto: true },
        authorName: "Sistema", ticketId: t.id, companyId: t.companyId,
      },
    }).catch(() => {});
  }
  return closed;
}
