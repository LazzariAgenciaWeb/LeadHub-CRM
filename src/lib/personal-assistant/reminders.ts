import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { buildFilaDoDia, formatFila } from "@/lib/assistant-tools/registry";
import { fmtDateTime, appUrl } from "@/lib/assistant-tools/types";
import { sendAssistantMessage } from "./whatsapp";

/**
 * Lembretes e resumo diário do assistente pessoal.
 *  - dispatchDueReminders: a cada minuto — AssistantNote REMINDER/TASK com dueAt
 *    vencido e ainda não avisado → WhatsApp (grupo) + push.
 *  - sendDailySummaries: uma vez por dia por usuário, a partir das 8h (fuso do
 *    sistema). Guarda a data do último envio em Setting pra ser idempotente.
 */

const TZ = process.env.SYSTEM_TIMEZONE || "America/Sao_Paulo";
const DAILY_HOUR = Number(process.env.ASSISTANT_DAILY_HOUR ?? 8);

function localDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function localHour(d = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(d));
}

export async function dispatchDueReminders(): Promise<{ sent: number }> {
  const now = new Date();
  const due = await prisma.assistantNote.findMany({
    where: { kind: { in: ["REMINDER", "TASK"] }, done: false, remindedAt: null, dueAt: { lte: now } },
    select: { id: true, userId: true, kind: true, title: true, body: true, dueAt: true },
    take: 50,
  });
  let sent = 0;
  for (const n of due) {
    const label = n.kind === "REMINDER" ? "⏰ Lembrete" : "☑️ Tarefa vence agora";
    const text = `${label}: *${n.title}*${n.body ? `\n${n.body}` : ""}\n_${fmtDateTime(n.dueAt)}_\n\nResponda "feito" pra concluir.`;
    const ok = await sendAssistantMessage(n.userId, text);
    await sendPushToUser(n.userId, { title: n.kind === "REMINDER" ? "⏰ Lembrete" : "☑️ Tarefa", body: n.title, url: appUrl("/assistente?aba=bloquinho"), tag: `assistant-${n.id}` });
    await prisma.assistantNote.update({ where: { id: n.id }, data: { remindedAt: now } });
    if (ok) sent++;
  }
  return { sent };
}

export async function sendDailySummaries(force = false): Promise<{ sent: number; skipped: number }> {
  if (!force && localHour() < DAILY_HOUR) return { sent: 0, skipped: 0 };
  const today = localDateKey();
  const users = await prisma.user.findMany({
    where: { assistantGroupJid: { not: null }, companyId: { not: null } },
    select: { id: true, name: true, companyId: true, role: true },
  });
  let sent = 0, skipped = 0;
  for (const u of users) {
    const key = `assistant_daily_sent:${u.id}`;
    const last = await prisma.setting.findUnique({ where: { key } });
    if (!force && last?.value === today) { skipped++; continue; }
    const fila = await buildFilaDoDia({ userId: u.id, companyId: u.companyId!, isManager: u.role !== "CLIENT" });
    const total = fila.esperandoPorMim.length + fila.hoje.length + fila.followUps.length + fila.semProximaAcao.length + fila.financeiro.length;
    const head = `Bom dia, ${u.name.split(" ")[0]}! ${total === 0 ? "Nada pendente hoje. ✅" : `Você tem *${total}* coisa(s) pedindo ação:`}`;
    const body = total === 0 ? head : `${head}\n\n${formatFila(fila, { max: 5 })}\n\n${appUrl("/assistente")}`;
    const ok = await sendAssistantMessage(u.id, body);
    await prisma.setting.upsert({ where: { key }, update: { value: today }, create: { key, value: today } });
    if (ok) sent++;
  }
  return { sent, skipped };
}
