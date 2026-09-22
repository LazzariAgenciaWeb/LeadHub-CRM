/**
 * Encontrar as cópias do mesmo email nas outras caixas da empresa — a base
 * da regra "tratou aqui, tratou pra todos".
 *
 * Duas formas de reconhecer, iguais às do agrupamento da lista
 * (src/lib/email-group.ts):
 *  1. mesmo Message-ID — redirecionamento: é literalmente a mesma mensagem;
 *  2. mesmo remetente + mesmo assunto + horário a até 10 min + CAIXA
 *     DIFERENTE — cobre o sistema que dispara um email por destinatário
 *     (cada disparo tem Message-ID próprio, mas pra quem lê é o mesmo email).
 *
 * A exigência de caixa diferente é a trava contra fundir mensagens de
 * verdade: duas mensagens distintas que caíram na MESMA caixa nunca casam.
 */
import { prisma } from "./prisma";
import { COPY_WINDOW_MIN } from "./email-group";
import type { Prisma } from "@/generated/prisma";

export interface CopyRef {
  id: string;
  messageId: string | null;
  accountId: string | null;
  fromEmail: string;
  subject: string;
  sentAt: Date;
}

/**
 * Where das cópias dos emails informados, excluindo os próprios.
 * `null` quando não há como procurar cópia.
 */
export function copiesWhere(companyId: string, emails: CopyRef[]): Prisma.InboxEmailWhereInput | null {
  if (!emails.length) return null;
  const ids = emails.map((e) => e.id);
  const messageIds = [...new Set(emails.map((e) => e.messageId).filter((m): m is string => !!m))];

  const or: Prisma.InboxEmailWhereInput[] = [];
  if (messageIds.length) or.push({ messageId: { in: messageIds } });
  for (const e of emails) {
    if (!e.fromEmail || !e.subject) continue;
    const janela = COPY_WINDOW_MIN * 60_000;
    or.push({
      fromEmail: e.fromEmail,
      subject: e.subject,
      sentAt: {
        gte: new Date(e.sentAt.getTime() - janela),
        lte: new Date(e.sentAt.getTime() + janela),
      },
      ...(e.accountId ? { accountId: { not: e.accountId } } : {}),
    });
  }
  if (!or.length) return null;

  return { companyId, id: { notIn: ids }, OR: or };
}

/** Ids das cópias — lista vazia quando não há nenhuma. */
export async function findCopyIds(companyId: string, emails: CopyRef[]): Promise<string[]> {
  const where = copiesWhere(companyId, emails);
  if (!where) return [];
  const rows = await prisma.inboxEmail.findMany({ where, select: { id: true } });
  return rows.map((r) => r.id);
}
