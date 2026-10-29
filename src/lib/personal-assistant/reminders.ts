import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { buildFilaDoDia, formatFila } from "@/lib/assistant-tools/registry";
import { fmtDateTime, appUrl } from "@/lib/assistant-tools/types";
import { sendAssistantMessage } from "./whatsapp";
import { userCanUseAssistant } from "./access";

/**
 * Lembretes e resumo diário do assistente pessoal.
 *  - dispatchDueReminders: a cada minuto — AssistantNote REMINDER/TASK com dueAt
 *    vencido e ainda não avisado → WhatsApp (grupo) + push.
 *    Prazo de TAREFA criada por rotina (MCP/webhook) não vira alarme: ela já
 *    aparece no resumo e na fila — senão cada rotina vira um bipe no WhatsApp.
 *  - sendDailySummaries: uma vez por dia por usuário, a partir das 8h (fuso do
 *    sistema). Guarda a data do último envio em Setting pra ser idempotente.
 *    Leva junto os avisos não urgentes das rotinas (AssistantDigestItem).
 *  - sendEveningDigests: a partir das 17h, se sobrou aviso de rotina na fila,
 *    manda tudo numa mensagem só.
 */

const TZ = process.env.SYSTEM_TIMEZONE || "America/Sao_Paulo";
const DAILY_HOUR = Number(process.env.ASSISTANT_DAILY_HOUR ?? 8);
const EVENING_HOUR = Number(process.env.ASSISTANT_EVENING_HOUR ?? 17);
const DIGEST_MAX = 10;

function localDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function localHour(d = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(d));
}

export async function dispatchDueReminders(): Promise<{ sent: number }> {
  const now = new Date();
  const due = await prisma.assistantNote.findMany({
    where: {
      kind: { in: ["REMINDER", "TASK"] }, done: false, archivedAt: null, remindedAt: null, dueAt: { lte: now },
      NOT: { kind: "TASK", source: { in: ["MCP", "WEBHOOK"] } },
    },
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
    if (!(await userCanUseAssistant(u.id))) { skipped++; continue; }
    const key = `assistant_daily_sent:${u.id}`;
    const last = await prisma.setting.findUnique({ where: { key } });
    if (!force && last?.value === today) { skipped++; continue; }
    const fila = await buildFilaDoDia({ userId: u.id, companyId: u.companyId!, isManager: u.role !== "CLIENT" });
    const total = fila.esperandoPorMim.length + fila.hoje.length + fila.followUps.length + fila.semProximaAcao.length + fila.financeiro.length;
    const head = `Bom dia, ${u.name.split(" ")[0]}! ${total === 0 ? "Nada pendente hoje. ✅" : `Você tem *${total}* coisa(s) pedindo ação:`}`;
    const digest = await takeDigest(u.id);
    const body = [total === 0 ? head : `${head}\n\n${formatFila(fila, { max: 5 })}`, digest?.text, appUrl("/assistente")].filter(Boolean).join("\n\n");
    const ok = await sendAssistantMessage(u.id, body);
    if (ok && digest) await markDigestSent(digest.ids);
    await prisma.setting.upsert({ where: { key }, update: { value: today }, create: { key, value: today } });
    if (ok) sent++;
  }
  return { sent, skipped };
}

/** Avisos de rotina pendentes, num bloco só ("📬 Das rotinas"). */
async function takeDigest(userId: string): Promise<{ ids: string[]; text: string } | null> {
  const items = await prisma.assistantDigestItem.findMany({ where: { userId, sentAt: null }, orderBy: { createdAt: "asc" }, take: 50 });
  if (!items.length) return null;
  const lines = items.slice(0, DIGEST_MAX).map((i) => {
    const [first, ...rest] = i.text.split("\n").map((l) => l.trim()).filter(Boolean);
    const extra = rest.join(" ").slice(0, 160);
    return `• ${first.slice(0, 140)}${extra ? `\n  _${extra}${rest.join(" ").length > 160 ? "…" : ""}_` : ""}`;
  });
  const more = items.length > DIGEST_MAX ? `\n…e mais ${items.length - DIGEST_MAX}.` : "";
  return { ids: items.map((i) => i.id), text: `📬 *Das rotinas* (${items.length}):\n${lines.join("\n")}${more}` };
}

async function markDigestSent(ids: string[]) {
  await prisma.assistantDigestItem.updateMany({ where: { id: { in: ids } }, data: { sentAt: new Date() } });
  // Guarda 30 dias pra consulta, depois some.
  await prisma.assistantDigestItem.deleteMany({ where: { sentAt: { lt: new Date(Date.now() - 30 * 86400_000) } } });
}

export async function sendEveningDigests(): Promise<{ sent: number }> {
  if (localHour() < EVENING_HOUR) return { sent: 0 };
  const today = localDateKey();
  const pending = await prisma.assistantDigestItem.groupBy({ by: ["userId"], where: { sentAt: null } });
  let sent = 0;
  for (const { userId } of pending) {
    const key = `assistant_evening_sent:${userId}`;
    const last = await prisma.setting.findUnique({ where: { key } });
    if (last?.value === today) continue;
    const digest = await takeDigest(userId);
    if (!digest) continue;
    const ok = await sendAssistantMessage(userId, `${digest.text}\n\n${appUrl("/assistente")}`);
    await prisma.setting.upsert({ where: { key }, update: { value: today }, create: { key, value: today } });
    if (ok) { await markDigestSent(digest.ids); sent++; }
  }
  return { sent };
}
