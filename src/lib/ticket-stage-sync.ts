// Etapas do kanban de Chamados (pipeline CHAMADOS) e a ligação com o status.
//
// Etapa e status são dois campos: a etapa é a coluna do kanban (configurável
// por empresa), o status é o que o resto do sistema lê (filtros, aviso ao
// cliente no WhatsApp, gamificação, link de acompanhamento). Os dois andam
// juntos — antes o kanban só trocava a etapa e o chamado "resolvido"
// continuava aberto pro resto do sistema.
//
// Este arquivo é puro (sem banco): o servidor usa pra gravar e a tela usa pra
// mostrar o mesmo resultado sem esperar o refresh. Carregar do banco fica em
// lib/ticket-stages.

export type TicketStage = { id: string; name: string; color: string; order: number; isFinal: boolean };

export const DEFAULT_TICKET_STAGES: TicketStage[] = [
  { id: "d0", name: "Novo",               color: "#6366f1", order: 0, isFinal: false },
  { id: "d1", name: "Em Análise",         color: "#8b5cf6", order: 1, isFinal: false },
  { id: "d2", name: "Aguardando Cliente", color: "#f59e0b", order: 2, isFinal: false },
  { id: "d3", name: "Em Execução",        color: "#3b82f6", order: 3, isFinal: false },
  { id: "d4", name: "Resolvido ✅",       color: "#22c55e", order: 4, isFinal: true  },
  { id: "d5", name: "Fechado",            color: "#64748b", order: 5, isFinal: true  },
];

export const isFinalStatus = (s: string | null | undefined) => s === "RESOLVED" || s === "CLOSED";

/**
 * Completa a mudança pedida pra etapa e status ficarem coerentes:
 *  - etapa final sem status → RESOLVED; sair de etapa final → IN_PROGRESS
 *  - status final sem etapa → 1ª etapa final (CLOSED → a última);
 *    reabrir sem etapa → 1ª etapa não final.
 * Devolve só o que precisa gravar além do que veio no pedido.
 */
export function syncStageStatus(args: {
  stages: TicketStage[];
  current: { status: string; ticketStage: string | null };
  next: { status?: string; ticketStage?: string | null };
}): { status?: string; ticketStage?: string } {
  const { stages, current, next } = args;
  const finals = stages.filter((s) => s.isFinal);
  const open = stages.filter((s) => !s.isFinal);
  const stageOf = (name: string | null | undefined) => stages.find((s) => s.name === name);
  const out: { status?: string; ticketStage?: string } = {};

  if (next.ticketStage !== undefined && next.status === undefined) {
    const to = stageOf(next.ticketStage);
    if (to?.isFinal && !isFinalStatus(current.status)) out.status = "RESOLVED";
    if (to && !to.isFinal && isFinalStatus(current.status)) out.status = "IN_PROGRESS";
  }

  if (next.status !== undefined && next.ticketStage === undefined) {
    const at = stageOf(current.ticketStage);
    if (isFinalStatus(next.status) && !at?.isFinal && finals.length) {
      out.ticketStage = (next.status === "CLOSED" ? finals[finals.length - 1] : finals[0]).name;
    }
    if (!isFinalStatus(next.status) && at?.isFinal && open.length) {
      out.ticketStage = open[0].name;
    }
  }
  return out;
}
