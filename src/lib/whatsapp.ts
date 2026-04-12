import { LeadStatus } from "@/generated/prisma";
import { prisma } from "./prisma";

/**
 * Resultado da identificação por palavra-chave.
 * campaignId é preenchido quando a regra está vinculada a uma campanha.
 */
interface MatchResult {
  status: LeadStatus;
  campaignId: string | null;
}

/**
 * Verifica as regras de gatilho da empresa e tenta identificar um match.
 * Retorna null se nenhuma regra bater.
 */
async function matchKeywordRules(
  message: string,
  companyId: string
): Promise<MatchResult | null> {
  const lower = message.toLowerCase();

  const rules = await prisma.keywordRule.findMany({
    where: { companyId },
    orderBy: { priority: "desc" },
  });

  for (const rule of rules) {
    if (lower.includes(rule.keyword.toLowerCase())) {
      return {
        status: rule.mapTo,
        campaignId: rule.campaignId ?? null,
      };
    }
  }

  return null;
}

/**
 * Processa uma mensagem recebida do webhook da Evolution API.
 *
 * Comportamento:
 * - Se a empresa tem "triggerOnly = true" OU tem regras cadastradas:
 *     só cria lead se alguma palavra-chave bater.
 *     O lead é vinculado à campanha da regra (se houver).
 * - Se não tem regras (modo padrão):
 *     toda mensagem vira lead com status NEW.
 */
export async function processInboundMessage(payload: {
  instanceName: string;
  phone: string;
  body: string;
  externalId?: string;
  rawPayload?: unknown;
  contactName?: string | null;
}) {
  const { instanceName, phone, body, externalId, rawPayload, contactName } = payload;

  // Achar a instância WhatsApp pelo nome
  const instance = await prisma.whatsappInstance.findFirst({
    where: { instanceName },
    include: { company: true },
  });

  if (!instance) {
    console.warn(`[WA] Instância não encontrada: ${instanceName}`);
    return null;
  }

  const companyId = instance.companyId;
  const triggerOnly = instance.company?.triggerOnly ?? false;

  // Checar se há regras cadastradas para esta empresa
  const rulesCount = await prisma.keywordRule.count({ where: { companyId } });

  let matchResult: MatchResult | null = null;

  if (rulesCount > 0) {
    matchResult = await matchKeywordRules(body, companyId);

    // Modo gatilho: se tem regras mas nenhuma bateu, ignora a mensagem
    if (!matchResult) {
      if (triggerOnly) {
        console.log(`[WA] Mensagem ignorada (sem match de gatilho): ${phone}`);
        // Salva a mensagem sem vincular a lead
        await prisma.message.create({
          data: {
            externalId: externalId ?? undefined,
            phone,
            body,
            direction: "INBOUND",
            processed: false,
            rawPayload: rawPayload ? (rawPayload as any) : undefined,
            companyId,
            instanceId: instance.id,
          },
        });
        return null;
      }
      // Se não é triggerOnly mas tem regras, cria lead NEW sem campanha
      matchResult = { status: LeadStatus.NEW, campaignId: null };
    }
  } else {
    // Sem regras: toda mensagem vira lead NEW
    matchResult = { status: LeadStatus.NEW, campaignId: null };
  }

  const { status: identifiedAs, campaignId } = matchResult;

  // Verificar se já existe lead com este telefone nesta empresa
  // (se tem campaignId, prioriza o lead da mesma campanha)
  let lead = await prisma.lead.findFirst({
    where: {
      phone,
      companyId,
      ...(campaignId ? { campaignId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  if (!lead) {
    // Buscar dados da campanha para enriquecer o lead
    let campaignSource: string | null = null;
    if (campaignId) {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { source: true },
      });
      if (campaign) {
        campaignSource = campaign.source.toLowerCase();
      }
    }

    const firstLeadStage = await prisma.pipelineStageConfig.findFirst({
      where: { companyId, pipeline: "LEADS" },
      orderBy: { order: "asc" },
    });

    lead = await prisma.lead.create({
      data: {
        phone,
        name: contactName ?? null,
        companyId,
        campaignId: campaignId ?? undefined,
        source: campaignSource ?? "whatsapp",
        status: identifiedAs,
        pipeline: "LEADS",
        pipelineStage: firstLeadStage?.name ?? null,
      },
    });
  } else {
    // Lead já existe — atualiza nome se ainda não tem e chegou um nome do WhatsApp
    const needsNameUpdate = !lead.name && contactName;
    const needsStatusUpdate = shouldUpgradeStatus(lead.status, identifiedAs);

    if (needsNameUpdate || needsStatusUpdate || (campaignId && !lead.campaignId)) {
      lead = await prisma.lead.update({
        where: { id: lead.id },
        data: {
          ...(needsStatusUpdate ? { status: identifiedAs } : {}),
          ...(needsNameUpdate ? { name: contactName } : {}),
          ...(campaignId && !lead.campaignId ? { campaignId } : {}),
        },
      });
    }
  }

  // Salvar a mensagem
  const message = await prisma.message.create({
    data: {
      externalId: externalId ?? undefined,
      phone,
      body,
      direction: "INBOUND",
      identifiedAs,
      processed: true,
      rawPayload: rawPayload ? (rawPayload as any) : undefined,
      companyId,
      instanceId: instance.id,
      campaignId: campaignId ?? undefined,
      leadId: lead.id,
    },
  });

  return { lead, message, identifiedAs, campaignId };
}

/**
 * Define se o novo status é uma "progressão" do status atual.
 * Evita regredir um lead fechado para "novo", por exemplo.
 */
function shouldUpgradeStatus(
  current: LeadStatus,
  next: LeadStatus
): boolean {
  const order: LeadStatus[] = [
    LeadStatus.NEW,
    LeadStatus.CONTACTED,
    LeadStatus.PROPOSAL,
    LeadStatus.CLOSED,
  ];
  const currentIdx = order.indexOf(current);
  const nextIdx = order.indexOf(next);
  return nextIdx > currentIdx;
}
