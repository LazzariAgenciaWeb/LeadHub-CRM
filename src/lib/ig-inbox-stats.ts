/**
 * Métricas da Inbox Social — derivadas das mensagens, não de colunas prontas.
 *
 * `IgConversation.needsReply` responde "falta responder AGORA", que é outra
 * pergunta: quem interagiu, quem voltou a falar depois do nosso contato e o
 * que daquilo virou lead só existe no histórico de IgMessage. Daí a agregação
 * por conversa aqui, reaproveitada pela lista (badges + filtros) e pelo painel.
 */
import { prisma } from "@/lib/prisma";

export type ConvoAgg = {
  inCount: number;
  outCount: number;
  firstIn: Date | null;
  firstOut: Date | null;
  lastIn: Date | null;
  /** O contato escreveu alguma coisa — a conversa não é só o que nós mandamos. */
  interacted: boolean;
  /** Nós falamos primeiro (prospecção, automação, disparo). */
  weStarted: boolean;
  /** O contato escreveu DEPOIS de nós — "retornou a conversa". */
  returned: boolean;
  /** Retorno ao primeiro contato NOSSO: respondeu a prospecção. */
  repliedToOutreach: boolean;
};

function blank(): ConvoAgg {
  return {
    inCount: 0, outCount: 0,
    firstIn: null, firstOut: null, lastIn: null,
    interacted: false, weStarted: false, returned: false, repliedToOutreach: false,
  };
}

/**
 * Conta IN/OUT e as pontas (primeira/última) de cada conversa num groupBy só.
 * Sempre sobre o histórico INTEIRO da conversa: "retornou" compara a última
 * mensagem do contato com a nossa primeira, e recortar por período quebraria a
 * comparação quando o nosso DM saiu antes da janela.
 */
export async function aggregateConversations(ids: string[]): Promise<Map<string, ConvoAgg>> {
  const out = new Map<string, ConvoAgg>();
  if (ids.length === 0) return out;

  const rows = await prisma.igMessage.groupBy({
    by: ["conversationId", "direction"],
    where: { conversationId: { in: ids } },
    _count: { _all: true },
    _min: { createdAt: true },
    _max: { createdAt: true },
  });

  for (const r of rows) {
    const agg = out.get(r.conversationId) ?? blank();
    if (r.direction === "IN") {
      agg.inCount = r._count._all;
      agg.firstIn = r._min.createdAt;
      agg.lastIn = r._max.createdAt;
    } else {
      agg.outCount = r._count._all;
      agg.firstOut = r._min.createdAt;
    }
    out.set(r.conversationId, agg);
  }

  for (const agg of out.values()) {
    agg.interacted = agg.inCount > 0;
    agg.weStarted = !!agg.firstOut && (!agg.firstIn || agg.firstOut < agg.firstIn);
    agg.returned = !!agg.lastIn && !!agg.firstOut && agg.lastIn > agg.firstOut;
    agg.repliedToOutreach = agg.weStarted && agg.inCount > 0;
  }
  return out;
}

/** O que a lista/os cards precisam saber de cada conversa. */
export type ConvoFlags = Pick<ConvoAgg, "interacted" | "weStarted" | "returned" | "repliedToOutreach"> & {
  inCount: number;
  outCount: number;
};

export function flagsOf(agg: ConvoAgg | undefined): ConvoFlags {
  const a = agg ?? blank();
  return {
    inCount: a.inCount,
    outCount: a.outCount,
    interacted: a.interacted,
    weStarted: a.weStarted,
    returned: a.returned,
    repliedToOutreach: a.repliedToOutreach,
  };
}

/** Filtros da inbox que dependem do histórico de mensagens. */
export const MESSAGE_FILTERS = ["returned", "interacted"] as const;
export type MessageFilter = (typeof MESSAGE_FILTERS)[number];

export function matchesMessageFilter(filter: MessageFilter, agg: ConvoAgg | undefined): boolean {
  if (!agg) return false;
  return filter === "returned" ? agg.returned : agg.interacted;
}
