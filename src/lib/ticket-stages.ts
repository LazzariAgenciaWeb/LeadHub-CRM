import { prisma } from "./prisma";
import { DEFAULT_TICKET_STAGES, type TicketStage } from "./ticket-stage-sync";

// Etapas do kanban de Chamados da empresa (ou as padrão, se ela não configurou).
// A regra etapa ↔ status mora em lib/ticket-stage-sync (pura, vale na tela).
export { DEFAULT_TICKET_STAGES, isFinalStatus, syncStageStatus, type TicketStage } from "./ticket-stage-sync";

export async function loadTicketStages(companyId: string): Promise<TicketStage[]> {
  const rows = await prisma.pipelineStageConfig.findMany({
    where:   { pipeline: "CHAMADOS", companyId },
    orderBy: { order: "asc" },
    select:  { id: true, name: true, color: true, order: true, isFinal: true },
  });
  return rows.length ? rows : DEFAULT_TICKET_STAGES;
}
