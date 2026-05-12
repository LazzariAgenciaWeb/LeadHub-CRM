import { prisma } from "./prisma";

// Helper pra criar notas de "evento" na timeline da conversa — bolhas
// especiais com ícone próprio (chamado, oportunidade, lead) renderizadas
// pelo parser do WhatsappManager. Não bloqueia o fluxo principal: erros
// são engolidos, é apenas decoração visual.
//
// Convenção de markers (prefixo no body):
//   🎫  → Chamado aberto       (type: TICKET_OPENED)
//   ✅  → Chamado resolvido    (type: TICKET_CLOSED)
//   💰  → Oportunidade criada  (type: OPP_CREATED)
//   🏆  → Oportunidade ganha   (type: OPP_WON)
//   ❌  → Oportunidade perdida (type: OPP_LOST)
//   🎯  → Lead criado          (type: LEAD_CREATED)
//   ➡️  → Lead mudou de etapa  (type: LEAD_MOVED)
//
// O parser detecta o emoji no início do body pra escolher cor/ícone.
// Mantém compatibilidade com 📅 (SCHEDULED) que já existia.

export type ConversationEventType =
  | "TICKET_OPENED"
  | "TICKET_CLOSED"
  | "OPP_CREATED"
  | "OPP_WON"
  | "OPP_LOST"
  | "LEAD_CREATED"
  | "LEAD_MOVED";

const EMOJI: Record<ConversationEventType, string> = {
  TICKET_OPENED: "🎫",
  TICKET_CLOSED: "✅",
  OPP_CREATED:   "💰",
  OPP_WON:       "🏆",
  OPP_LOST:      "❌",
  LEAD_CREATED:  "🎯",
  LEAD_MOVED:    "➡️",
};

interface CreateEventArgs {
  // Localizador: passe ConversationId direto OU companyId+phone (lookup)
  conversationId?: string | null;
  companyId?: string;
  phone?: string;

  type:    ConversationEventType;
  message: string;          // texto curto sem emoji (será prepended)
  authorId?:   string | null;
  authorName?: string | null;
  // Metadata opcional embutida no body como sufixo " · key=value" — útil
  // pra UI poder linkar de volta pro recurso (ex: ticketId, leadId).
  meta?: Record<string, string | number | null | undefined>;
}

/**
 * Cria uma ConversationNote do tipo evento. Fire-and-forget — nunca
 * bloqueia a resposta da API e nunca lança.
 */
export async function createConversationEvent(args: CreateEventArgs): Promise<void> {
  try {
    let convId: string | null = args.conversationId ?? null;

    if (!convId && args.companyId && args.phone) {
      const conv = await prisma.conversation.findUnique({
        where: { companyId_phone: { companyId: args.companyId, phone: args.phone } },
        select: { id: true },
      });
      convId = conv?.id ?? null;
    }
    if (!convId) return;

    const emoji = EMOJI[args.type];
    const metaPart = args.meta
      ? " " + Object.entries(args.meta)
          .filter(([, v]) => v !== null && v !== undefined && v !== "")
          .map(([k, v]) => `[${k}=${v}]`)
          .join("")
      : "";
    const body = `${emoji} ${args.message}${metaPart}`.trim();

    await prisma.conversationNote.create({
      data: {
        conversationId: convId,
        body,
        type:       args.type,
        authorId:   args.authorId ?? null,
        authorName: args.authorName ?? "Sistema",
      },
    });
  } catch {
    /* não crítico — bolhas de evento são decoração */
  }
}
