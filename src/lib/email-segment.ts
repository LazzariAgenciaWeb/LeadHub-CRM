/**
 * Tradução do segmentFilter (JSON salvo na EmailCampaign) pra um `where`
 * do Prisma sobre Lead. Usado tanto pelo preview (contar antes de disparar)
 * quanto pelo start da campanha (materializar EmailRecipients).
 *
 * Shape do filtro (MVP):
 *   {
 *     pipeline?: "PROSPECCAO" | "LEADS" | "OPORTUNIDADES",
 *     pipelineStage?: string,
 *     tagIds?: string[],     // lead deve ter PELO MENOS uma dessas tags
 *     hasEmail: true         // sempre — campanha precisa de email
 *   }
 *
 * Fase B adiciona: minValue, customFields, sem-resposta-há-X-dias.
 */
import type { Prisma } from "@/generated/prisma";

export interface SegmentFilter {
  pipeline?: string | null;
  pipelineStage?: string | null;
  tagIds?: string[];
  hasEmail?: boolean;
}

export function buildLeadWhereFromSegment(
  companyId: string,
  filter: SegmentFilter
): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = { companyId };

  // Sempre exige email não-nulo e não-vazio (campanha precisa de destino)
  where.email = { not: null };

  if (filter.pipeline) where.pipeline = filter.pipeline;
  if (filter.pipelineStage) where.pipelineStage = filter.pipelineStage;

  if (filter.tagIds && filter.tagIds.length > 0) {
    // Lead tem pelo menos uma das tags selecionadas
    where.tags = { some: { tagId: { in: filter.tagIds } } };
  }

  // Não envia pra leads internos (visíveis só ao SUPER_ADMIN)
  where.isInternal = false;

  return where;
}

/** Normaliza/valida o filtro vindo do body. Garante hasEmail=true. */
export function sanitizeSegmentFilter(raw: any): SegmentFilter {
  return {
    pipeline: typeof raw?.pipeline === "string" && raw.pipeline ? raw.pipeline : null,
    pipelineStage: typeof raw?.pipelineStage === "string" && raw.pipelineStage ? raw.pipelineStage : null,
    tagIds: Array.isArray(raw?.tagIds) ? raw.tagIds.filter((t: unknown) => typeof t === "string") : [],
    hasEmail: true,
  };
}
