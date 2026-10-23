/**
 * "O que mais fala sobre isso?" — tudo que anda junto com um email.
 *
 * São três fios diferentes, e a tela mostra os três no mesmo painel:
 *
 *  1. CONVERSA  — encadeamento de resposta (In-Reply-To) e mesmo assunto.
 *                 É o que já existia: pergunta e resposta, o encaminhamento
 *                 que você mandou e o "está pronto" de quem executou.
 *  2. CASO      — mensagens diferentes sobre a mesma coisa, reconhecidas pelo
 *                 remetente + identificador no assunto (domínio, boleto).
 *                 É o registro.br: aviso, lembrete, renovação, fatura e
 *                 confirmação, cada um com assunto próprio.
 *  3. AGRUPADO  — o que você marcou à mão (InboxEmail.caseId), pra quando a
 *                 regra não liga sozinha.
 *
 * Um lugar só porque duas telas dependem disso e elas não podem discordar: o
 * painel do leitor (o que você vê) e o "resolver o caso" (o que é arquivado).
 */
import { prisma } from "./prisma";
import { loadEmailThread } from "./email-thread";
import { caseKeyOf, CASE_WINDOW_DAYS, senderDomain, PUBLIC_EMAIL_DOMAINS } from "./email-cases";

export type RelatedReason = "THREAD" | "CASE" | "MANUAL";

/** Teto de candidatos do caso automático numa consulta. */
const MAX_CANDIDATOS = 200;

const SELECT = {
  id: true, direction: true, folder: true, messageId: true, inReplyTo: true,
  fromEmail: true, fromName: true, toEmail: true, subject: true, snippet: true,
  seen: true, sentAt: true, accountId: true, caseId: true,
  account: { select: { id: true, label: true, fromEmail: true } },
  _count: { select: { attachments: true } },
} as const;

export type RelatedEmail = Awaited<ReturnType<typeof carregar>>[number];

async function carregar(ids: string[], companyId: string) {
  return prisma.inboxEmail.findMany({
    where: { id: { in: ids }, companyId },
    orderBy: { sentAt: "asc" },
    select: SELECT,
  });
}

/**
 * Ids de tudo que anda junto com `emailId`, com o motivo de cada um.
 * O motivo mais forte vence: conversa > agrupado à mão > caso automático.
 */
export async function relatedEmailIds(
  companyId: string,
  emailId: string,
  allowedAccountIds: string[] | null,
): Promise<Map<string, RelatedReason>> {
  const motivos = new Map<string, RelatedReason>();
  const accountScope = allowedAccountIds ? { accountId: { in: allowedAccountIds } } : {};

  const seed = await prisma.inboxEmail.findFirst({
    where: { id: emailId, companyId, ...accountScope },
    select: { id: true, fromEmail: true, subject: true, sentAt: true, caseId: true },
  });
  if (!seed) return motivos;

  const anotar = (id: string, motivo: RelatedReason) => {
    const atual = motivos.get(id);
    const peso = { THREAD: 3, MANUAL: 2, CASE: 1 } as const;
    if (!atual || peso[motivo] > peso[atual]) motivos.set(id, motivo);
  };

  // 3. agrupado à mão — primeiro, pra ser sobrescrito pelos mais fortes
  if (seed.caseId) {
    const manuais = await prisma.inboxEmail.findMany({
      where: { companyId, caseId: seed.caseId, ...accountScope },
      select: { id: true },
      take: MAX_CANDIDATOS,
    });
    for (const m of manuais) anotar(m.id, "MANUAL");
  }

  // 2. caso automático: mesma chave, dentro da janela
  const chave = caseKeyOf(seed);
  if (chave) {
    const dominio = senderDomain(seed.fromEmail);
    const porDominio = !!dominio && !PUBLIC_EMAIL_DOMAINS.has(dominio);
    const meio = seed.sentAt.getTime();
    const candidatos = await prisma.inboxEmail.findMany({
      where: {
        companyId,
        direction: "IN",
        sentAt: {
          gte: new Date(meio - CASE_WINDOW_DAYS * 86_400_000),
          lte: new Date(meio + CASE_WINDOW_DAYS * 86_400_000),
        },
        ...(porDominio
          ? { fromEmail: { endsWith: `@${dominio}`, mode: "insensitive" as const } }
          : { fromEmail: { equals: seed.fromEmail, mode: "insensitive" as const } }),
        ...accountScope,
      },
      select: { id: true, fromEmail: true, subject: true, sentAt: true },
      take: MAX_CANDIDATOS,
    });
    for (const c of candidatos) if (caseKeyOf(c) === chave) anotar(c.id, "CASE");
  }

  // 1. conversa (o fio mais forte)
  const thread = await loadEmailThread(companyId, emailId, allowedAccountIds);
  for (const m of thread ?? []) anotar(m.id, "THREAD");

  anotar(emailId, motivos.get(emailId) ?? "THREAD");
  return motivos;
}

/**
 * As mensagens relacionadas, em ordem cronológica e com o motivo — formato
 * que o painel do leitor consome.
 */
export async function loadRelatedEmails(
  companyId: string,
  emailId: string,
  allowedAccountIds: string[] | null,
) {
  const motivos = await relatedEmailIds(companyId, emailId, allowedAccountIds);
  if (motivos.size === 0) return null;
  const rows = await carregar([...motivos.keys()], companyId);
  return rows.map((r) => ({ ...r, reason: motivos.get(r.id) ?? "CASE" as RelatedReason }));
}
