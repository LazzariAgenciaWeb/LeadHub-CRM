import { randomBytes } from "crypto";
import { prisma } from "./prisma";
import { readComments, type TaskComment } from "./checklist";
import { SYSTEM_TIMEZONE } from "./business-hours";

/**
 * Aprovação de peças pelo cliente (gestão de mídias, piloto).
 *
 * Fluxo: equipe anexa a peça num andamento da tarefa → "Enviar pra aprovação"
 * gera/reaproveita o link /aprovar/[token], abre uma RODADA nova e manda o link
 * no grupo do WhatsApp do cliente (configurado no projeto). O cliente aprova ou
 * pede ajuste pelo link, sem login. O cron /api/cron/aprovacoes lembra no grupo
 * quem passou de N dias sem aprovar, diferenciando "nem abriu" de "abriu e não
 * aprovou".
 *
 * Status da tarefa continua sendo a fonte única: em aprovação = AGUARDANDO_CLIENTE,
 * aprovada = APROVADO, ajuste pedido = EM_PRODUCAO.
 */

export function newApprovalToken(): string {
  return randomBytes(18).toString("base64url");
}

export function appBaseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "").replace(/\/+$/, "");
}

export function approvalUrl(token: string): string {
  return `${appBaseUrl()}/aprovar/${token}`;
}

/**
 * Andamento que vira a "versão" em aprovação: o mais recente com anexo e
 * visível pro cliente. null = tarefa sem peça anexada.
 */
export function latestVersionComment(raw: unknown): TaskComment | null {
  const list = readComments(raw).filter((c) => c.by !== "client" && c.vis !== false && c.attachments?.length);
  return list.length ? list[list.length - 1] : null;
}

/**
 * Instância que fala no grupo: a da conversa existente com o grupo (é a que
 * está dentro dele). Sem conversa ainda, cai na 1ª instância conectada da
 * empresa que aceita grupos.
 */
export async function resolveGroupInstanceId(agencyCompanyId: string, groupJid: string): Promise<string | null> {
  const conv = await prisma.conversation.findFirst({
    where: { companyId: agencyCompanyId, phone: groupJid, instanceId: { not: null } },
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    select: { instanceId: true },
  });
  if (conv?.instanceId) return conv.instanceId;
  const inst = await prisma.whatsappInstance.findFirst({
    where: { companyId: agencyCompanyId, acceptGroups: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return inst?.id ?? null;
}

const fmtDia = (d: Date) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: SYSTEM_TIMEZONE });

export function sendMessageText(t: { title: string; round: number; token: string }): string {
  const versao = t.round > 1 ? `\n_Versão ${t.round}, já com os ajustes pedidos._\n` : "";
  return [
    `📣 *Peça pronta pra aprovação*`,
    `*${t.title}*`,
    versao,
    `Veja e aprove por aqui 👇`,
    approvalUrl(t.token),
    ``,
    `Se quiser algum ajuste, é só escrever no próprio link.`,
  ].join("\n").replace(/\n{3,}/g, "\n\n");
}

export type PendingItem = { title: string; token: string; sentAt: Date; viewed: boolean };

/** Lembrete no grupo — agrupa todas as peças vencidas do projeto numa mensagem só. */
export function reminderText(items: PendingItem[]): string {
  if (items.length === 1) {
    const it = items[0];
    return it.viewed
      ? `⏰ Passando pra lembrar: a peça *${it.title}* já foi vista, mas ainda falta a aprovação.\nAprove ou peça ajuste por aqui 👇\n${approvalUrl(it.token)}`
      : `⏰ Passando pra lembrar: a peça *${it.title}* está esperando aprovação desde ${fmtDia(it.sentAt)}.\nÉ só abrir 👇\n${approvalUrl(it.token)}`;
  }
  const linhas = items.map((it) =>
    `• *${it.title}*${it.viewed ? " (vista, falta aprovar)" : ` (desde ${fmtDia(it.sentAt)})`}\n  ${approvalUrl(it.token)}`,
  );
  return [`⏰ Passando pra lembrar: ${items.length} peças estão esperando aprovação.`, ``, ...linhas].join("\n");
}

/** Lembrete só em dia útil, das 9h às 18h (horário de Brasília). */
export function inReminderWindow(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SYSTEM_TIMEZONE, weekday: "short", hour: "numeric", hour12: false,
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  return !["Sat", "Sun"].includes(wd) && hour >= 9 && hour < 18;
}
