import { prisma } from "./prisma";

/**
 * Vincula ao lead os emails da caixa de entrada trocados com `address`
 * (recebidos DELE ou enviados PRA ELE) que ainda não estão ligados a nenhum
 * lead. Usado quando o lead ganha/troca de email (criação, edição) e pelo
 * botão "Vincular emails de ..." no drawer.
 *
 * Só pega email SEM vínculo: não rouba email que alguém já ligou a outro
 * lead/negociação manualmente.
 *
 * toEmail guarda os destinatários separados por vírgula, então o casamento
 * é por item da lista (não substring solta — "ana@x.com" não pode casar
 * com "joana@x.com").
 */
export async function linkEmailsByAddress(
  companyId: string,
  leadId: string,
  address: string | null | undefined,
): Promise<number> {
  const addr = address?.trim().toLowerCase();
  if (!addr || !addr.includes("@")) return 0;

  const ci = "insensitive" as const;
  const result = await prisma.inboxEmail.updateMany({
    where: {
      companyId,
      leadId: null,
      OR: [
        { fromEmail: { equals: addr, mode: ci } },
        { toEmail: { equals: addr, mode: ci } },
        { toEmail: { startsWith: `${addr},`, mode: ci } },
        { toEmail: { endsWith: `,${addr}`, mode: ci } },
        { toEmail: { endsWith: `, ${addr}`, mode: ci } },
        { toEmail: { contains: `,${addr},`, mode: ci } },
        { toEmail: { contains: `, ${addr},`, mode: ci } },
      ],
    },
    data: { leadId },
  });
  return result.count;
}
