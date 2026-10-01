/**
 * Conversa (thread) de um email — o histórico do que foi dito e decidido.
 *
 * O encadeamento já é gravado de ponta a ponta: a resposta enviada daqui sai
 * com In-Reply-To do original, e a resposta que volta chega apontando pro que
 * mandamos. Aqui esses fios viram uma lista cronológica.
 *
 * Como monta:
 *  1. sobe e desce pelos identificadores (pai por messageId, filhos por
 *     inReplyTo), em rodadas, até fechar a árvore;
 *  2. completa pelo assunto — mesmo assunto base (sem Re:/Fwd:) com um
 *     participante em comum, dentro de 180 dias. Isso recupera a thread
 *     quando falta um elo (mensagem trocada fora do GoHub, cliente que
 *     respondeu começando um email novo).
 *
 * Respeita a restrição de caixas por setor: só entram mensagens das caixas
 * que o usuário enxerga.
 */
import { prisma } from "./prisma";
import { groupEmailCopies, normalizeSubject } from "./email-group";

/** Teto de mensagens na conversa e de rodadas de busca. */
const MAX_THREAD = 50;
const MAX_ROUNDS = 5;
/** Janela do complemento por assunto. */
const SUBJECT_WINDOW_DAYS = 180;

const THREAD_SELECT = {
  id: true, direction: true, folder: true, messageId: true, inReplyTo: true,
  fromEmail: true, fromName: true, toEmail: true, subject: true, snippet: true,
  seen: true, sentAt: true, accountId: true,
  account: { select: { id: true, label: true, fromEmail: true } },
  _count: { select: { attachments: true } },
} as const;

export async function loadEmailThread(
  companyId: string,
  emailId: string,
  allowedAccountIds: string[] | null
) {
  const accountScope = allowedAccountIds ? { accountId: { in: allowedAccountIds } } : {};

  const seed = await prisma.inboxEmail.findFirst({
    where: { id: emailId, companyId, ...accountScope },
    select: THREAD_SELECT,
  });
  if (!seed) return null;

  const found = new Map<string, typeof seed>([[seed.id, seed]]);

  // ── 1. Sobe e desce pelos identificadores ──
  let novosMessageIds = seed.messageId ? [seed.messageId] : [];
  let novosInReplyTo = seed.inReplyTo ? [seed.inReplyTo] : [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const or = [];
    if (novosInReplyTo.length) or.push({ messageId: { in: novosInReplyTo } }); // pais
    if (novosMessageIds.length) or.push({ inReplyTo: { in: novosMessageIds } }); // filhos
    if (!or.length) break;

    const rows = await prisma.inboxEmail.findMany({
      where: { companyId, ...accountScope, OR: or },
      select: THREAD_SELECT,
      take: MAX_THREAD,
    });

    novosMessageIds = [];
    novosInReplyTo = [];
    for (const r of rows) {
      if (found.has(r.id)) continue;
      found.set(r.id, r);
      if (r.messageId) novosMessageIds.push(r.messageId);
      if (r.inReplyTo) novosInReplyTo.push(r.inReplyTo);
    }
    if (!novosMessageIds.length && !novosInReplyTo.length) break;
    if (found.size >= MAX_THREAD) break;
  }

  // ── 2. Completa pelo assunto + participante em comum ──
  const base = normalizeSubject(seed.subject);
  if (base && found.size < MAX_THREAD) {
    const janela = SUBJECT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const participantes = [
      seed.fromEmail,
      ...seed.toEmail.split(/[,;]/).map((x) => x.trim().replace(/^.*<|>.*$/g, "")),
    ].filter(Boolean);

    const rows = await prisma.inboxEmail.findMany({
      where: {
        companyId,
        ...accountScope,
        subject: { contains: base, mode: "insensitive" },
        sentAt: {
          gte: new Date(seed.sentAt.getTime() - janela),
          lte: new Date(seed.sentAt.getTime() + janela),
        },
        OR: participantes.flatMap((p) => [
          { fromEmail: p },
          { toEmail: { contains: p, mode: "insensitive" as const } },
        ]),
      },
      select: THREAD_SELECT,
      orderBy: { sentAt: "asc" },
      take: MAX_THREAD,
    });
    for (const r of rows) if (!found.has(r.id)) found.set(r.id, r);
  }

  // Cópias do mesmo email (várias caixas) viram uma linha só, igual na lista.
  const messages = groupEmailCopies(
    [...found.values()].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime()),
    MAX_THREAD
  );

  return messages;
}
