import { Prisma, LeadStatus, MessageDir, ConversationStatus, ActivityType } from "@/generated/prisma";
import { prisma } from "./prisma";

/**
 * Upsert idempotente de Conversation.
 *
 * Cria a conversa se não existir, ou atualiza a existente:
 *   - lastMessageAt/Body/Direction sempre refletem a mensagem mais recente
 *   - status segue a máquina de transição abaixo
 *   - unreadCount: INBOUND incrementa, OUTBOUND zera
 *   - setor é herdado da instância (via SetorInstance) na primeira mensagem
 *
 * Máquina de transição:
 *   ─ INBOUND chegando (cliente mandou mensagem) ─
 *     SEMPRE vai para OPEN — indica "precisa resposta", para o atendente
 *     não esquecer de responder. CLOSED → OPEN cria Activity CONVERSATION_REOPENED.
 *     (Nem mesmo IN_PROGRESS resiste: cliente respondeu = bola está com a gente.)
 *   ─ OUTBOUND chegando (atendente respondeu) ─
 *     SEMPRE vai para IN_PROGRESS.
 *
 * Idempotência em race condition: usa o unique constraint (companyId, phone)
 * via upsert. 4 webhooks simultâneos para o mesmo grupo → só 1 conversa criada.
 */
export async function upsertConversation(args: {
  companyId: string;
  phone: string;
  direction: MessageDir;
  body: string;
  instanceId?: string | null;
  receivedAt?: Date;
}): Promise<{ id: string; statusChanged: boolean; previousStatus: ConversationStatus | null }> {
  const { companyId, phone, direction, body, instanceId, receivedAt } = args;
  const now = receivedAt ?? new Date();
  const isGroup = phone.includes("@g.us") || phone.includes("@lid");
  const bodyPreview = body.slice(0, 200);

  // Busca conversa existente
  const existing = await prisma.conversation.findUnique({
    where: { companyId_phone: { companyId, phone } },
    select: { id: true, status: true, firstResponseAt: true, setorId: true },
  });

  // Define o novo status conforme a transição.
  // Regra única: INBOUND → OPEN (precisa resposta) · OUTBOUND → IN_PROGRESS (em fluxo).
  // Cliente respondeu = bola está com a gente, mesmo que atendente já estivesse no caso.
  // PENDING (= OPEN com SLA estourado) é setado pelo job /api/cron/sla.
  // EXCEÇÃO: SCHEDULED resiste ao OUTBOUND (atendente mandou follow-up mas continua
  //          aguardando o retorno marcado). Só uma INBOUND quebra o standby.
  let newStatus: ConversationStatus;
  if (direction === "INBOUND") {
    newStatus = "OPEN";
  } else if (existing?.status === "SCHEDULED") {
    newStatus = "SCHEDULED"; // mantém standby após follow-up
  } else {
    newStatus = "IN_PROGRESS";
  }

  const statusChanged = !existing || existing.status !== newStatus;

  // Para nova conversa: tenta herdar setor da instância
  let setorId: string | null = existing?.setorId ?? null;
  if (!existing && instanceId) {
    const setorInstance = await prisma.setorInstance.findFirst({
      where: { instanceId },
      select: { setorId: true },
    });
    setorId = setorInstance?.setorId ?? null;
  }

  // unreadCount: INBOUND incrementa; OUTBOUND zera
  // (no upsert do Prisma não dá pra usar increment no create, então tratamos via update)
  const conversation = await prisma.conversation.upsert({
    where: { companyId_phone: { companyId, phone } },
    create: {
      companyId,
      phone,
      isGroup,
      status: newStatus,
      statusUpdatedAt: now,
      lastMessageAt: now,
      lastMessageBody: bodyPreview,
      lastMessageDirection: direction,
      unreadCount: direction === "INBOUND" ? 1 : 0,
      setorId: setorId ?? undefined,
      firstResponseAt: direction === "OUTBOUND" ? now : null,
      closedAt: null,
    },
    update: {
      lastMessageAt: now,
      lastMessageBody: bodyPreview,
      lastMessageDirection: direction,
      ...(statusChanged ? { status: newStatus, statusUpdatedAt: now } : {}),
      // newStatus nunca é CLOSED via ingestão — toda mensagem nova reabre uma conversa fechada
      closedAt: null,
      ...(direction === "INBOUND"
        ? { unreadCount: { increment: 1 } }
        : { unreadCount: 0 }),
      ...(direction === "OUTBOUND" && existing && !existing.firstResponseAt
        ? { firstResponseAt: now }
        : {}),
    },
    select: { id: true },
  });

  // Log de reabertura
  if (existing && existing.status === "CLOSED" && newStatus === "OPEN") {
    await prisma.activity.create({
      data: {
        type: ActivityType.CONVERSATION_REOPENED,
        body: "Cliente respondeu — conversa reaberta",
        conversationId: conversation.id,
        companyId,
      },
    }).catch(() => {/* não crítico */});
  }

  // Sincroniza Lead.attendanceStatus (legacy) com Conversation.status
  // Mantém telas antigas (Dashboard, AI, filtros) consistentes com a nova fonte da verdade.
  // Mapping:
  //   OPEN | PENDING                  → WAITING
  //   IN_PROGRESS | WAITING_CUSTOMER  → IN_PROGRESS
  //   CLOSED                          → RESOLVED
  if (statusChanged) {
    const legacy = mapConvStatusToLegacy(newStatus);
    await prisma.lead.updateMany({
      where: { conversationId: conversation.id, attendanceStatus: { not: legacy } },
      data:  { attendanceStatus: legacy },
    }).catch(() => {/* não crítico */});
  }

  return {
    id: conversation.id,
    statusChanged,
    previousStatus: existing?.status ?? null,
  };
}

/**
 * Traduz Conversation.status → Lead.attendanceStatus legacy.
 * @deprecated Lead.attendanceStatus está marcado para remoção; use Conversation.status diretamente.
 */
export function mapConvStatusToLegacy(status: ConversationStatus): "WAITING" | "IN_PROGRESS" | "RESOLVED" | "SCHEDULED" {
  switch (status) {
    case "OPEN":
    case "PENDING":
      return "WAITING";
    case "IN_PROGRESS":
    case "WAITING_CUSTOMER":
      return "IN_PROGRESS";
    case "SCHEDULED":
      return "SCHEDULED";
    case "CLOSED":
      return "RESOLVED";
  }
}

/**
 * Gera variações comuns de um número (com/sem 55, com/sem o 9 extra) — usado
 * para comparar identidades de instâncias da empresa contra o participante de
 * uma mensagem de grupo (Evolution às vezes envia o JID @lid sem 55 ou sem 9).
 */
function phoneVariants(raw: string): string[] {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return [];
  const set = new Set<string>([digits]);
  // Brasil: tem 13 chars → 55 + DDD2 + 9digitos. Variações:
  if (digits.startsWith("55")) {
    const noCountry = digits.slice(2);
    set.add(noCountry);
    // Se tem 9 extra após o DDD (DDD2 + 9XXXXXXXX), oferece versão sem o 9
    if (noCountry.length === 11 && noCountry[2] === "9") {
      set.add("55" + noCountry.slice(0, 2) + noCountry.slice(3));
      set.add(noCountry.slice(0, 2) + noCountry.slice(3));
    }
  } else if (digits.length === 10 || digits.length === 11) {
    // Sem código do país → adiciona com 55
    set.add("55" + digits);
  }
  return [...set];
}

/**
 * Retorna true se o número informado corresponde a alguma das WhatsappInstance
 * da empresa (considerando variações de DDI/9 extra).
 *
 * Usado para detectar mensagens de GRUPO onde o participante remetente é uma
 * das nossas próprias instâncias — nesse caso a mensagem é OUTBOUND (envio
 * nosso, ouvido pelas demais instâncias do grupo).
 */
async function isPhoneOurInstance(phone: string, companyId: string): Promise<boolean> {
  const variants = phoneVariants(phone);
  if (variants.length === 0) return false;
  const found = await prisma.whatsappInstance.findFirst({
    where: {
      companyId,
      phone: { in: variants },
    },
    select: { id: true },
  });
  return !!found;
}

/**
 * Salva (ou atualiza) o nome de exibição do WhatsApp (pushName) em CompanyContact.
 * Usado para contatos individuais que ficam apenas na inbox sem gerar lead.
 * Só preenche o nome — não sobrescreve um nome já preenchido anteriormente,
 * exceto se o registro ainda não tinha nome (evitar apagar nome customizado no CRM).
 */
async function saveWAContactName(phone: string, name: string, companyId: string) {
  await prisma.companyContact.upsert({
    where: { companyId_phone: { companyId, phone } },
    create: { phone, name, isGroup: false, companyId },
    // Atualiza sempre — pushName pode mudar; na UI, Lead.name tem prioridade sobre CompanyContact.name
    update: { name },
  }).catch(() => {}); // Ignora erros transitórios — não crítico
}

/**
 * Cria uma Message de forma idempotente.
 * Se externalId for fornecido usa upsert (update: {}) para ser atômico e evitar
 * o race condition de dois webhooks simultâneos para a mesma mensagem.
 * Sem externalId faz create normal.
 */
async function safeCreateMessage(data: Prisma.MessageUncheckedCreateInput) {
  const externalId = data.externalId ?? undefined;
  if (externalId) {
    try {
      return await prisma.message.upsert({
        where: { externalId },
        create: data,
        update: {}, // já existe → ignorar silenciosamente
      });
    } catch (e: any) {
      // P2002 = race condition: outra instância inseriu antes (grupos com várias instâncias)
      if (e?.code === "P2002") return null;
      throw e;
    }
  }
  return prisma.message.create({ data });
}

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
  participantPhone?: string | null;
  participantName?: string | null;
  receivedAt?: Date;
  quotedId?: string | null;
  quotedBody?: string | null;
  mediaBase64?: string | null;
  mediaType?: string | null;
}) {
  const { instanceName, phone, body, externalId, rawPayload, contactName, participantPhone, participantName, receivedAt, quotedId, quotedBody, mediaBase64, mediaType } = payload;

  // Log de entrada — visível nos logs do servidor (Railway/Vercel)
  console.log(`[WA inbound] instance=${instanceName} phone=${phone} externalId=${externalId ?? "?"} body="${body.slice(0, 60)}"`);

  // Mensagens de grupo e @lid (identidade anônima WhatsApp Business) → salvar na inbox, sem criar lead
  if (phone.includes("@g.us") || phone.includes("@lid")) {
    const instance = await prisma.whatsappInstance.findFirst({ where: { instanceName } });
    if (!instance) return null;

    // @lid: verificar se este identificador foi mesclado com um número real.
    // Se sim, redireciona para o processamento normal com o número real —
    // evita que futuros webhooks do @lid reconstruam a conversa separada.
    if (phone.includes("@lid")) {
      const alias = await prisma.setting.findUnique({
        where: { key: `phone_alias:${instance.companyId}:${phone}` },
      });
      if (alias?.value) {
        console.log(`[WA inbound] @lid alias ${phone} → ${alias.value}`);
        return processInboundMessage({ ...payload, phone: alias.value });
      }
    }

    // Em grupo, descobre se quem ENVIOU é uma das nossas instâncias.
    // Se for, trata como OUTBOUND (não devolve a conversa para OPEN só porque
    // outra instância nossa ouviu o eco do envio).
    const isOurParticipant = participantPhone
      ? await isPhoneOurInstance(participantPhone, instance.companyId)
      : false;
    const groupDirection: "INBOUND" | "OUTBOUND" = isOurParticipant ? "OUTBOUND" : "INBOUND";

    // Upsert da conversa (grupo) — herda setor da instância na criação
    const conv = await upsertConversation({
      companyId: instance.companyId,
      phone,
      direction: groupDirection,
      body,
      instanceId: instance.id,
      receivedAt,
    });

    // safeCreateMessage usa upsert para ser atômico — evita duplicate key em webhooks simultâneos
    await safeCreateMessage({
      externalId: externalId ?? undefined,
      phone,
      participantPhone: participantPhone ?? undefined,
      participantName: participantName ?? undefined,
      body,
      direction: groupDirection,
      processed: false,
      rawPayload: rawPayload ? (rawPayload as any) : undefined,
      companyId: instance.companyId,
      instanceId: instance.id,
      conversationId: conv.id,
      ...(mediaBase64 ? { mediaBase64, mediaType: mediaType ?? null } : {}),
    });

    // Upsert do CompanyContact com nome do grupo (busca na Evolution se ainda não tem nome)
    const existing = await prisma.companyContact.findFirst({
      where: { phone, companyId: instance.companyId },
    });
    if (!existing || !existing.name) {
      const { evolutionGetGroupName } = await import("./evolution");
      const groupName = await evolutionGetGroupName(instanceName, phone, (instance as any).instanceToken ?? null);
      if (groupName) {
        await prisma.companyContact.upsert({
          where: { companyId_phone: { companyId: instance.companyId, phone } },
          create: { phone, name: groupName, isGroup: true, companyId: instance.companyId },
          update: { name: groupName, isGroup: true },
        });
      }
    }

    return null;
  }

  // Achar a instância WhatsApp pelo nome
  const instance = await prisma.whatsappInstance.findFirst({
    where: { instanceName },
    include: { company: true },
  });

  if (!instance) {
    console.warn(`[WA inbound] INSTANCIA NAO ENCONTRADA: "${instanceName}" — verifique se o nome no banco bate com o enviado pela Evolution`);
    return null;
  }

  const companyId = instance.companyId;
  const triggerOnly = instance.company?.triggerOnly ?? false;

  // Checar se há regras cadastradas para esta empresa
  const rulesCount = await prisma.keywordRule.count({ where: { companyId } });

  console.log(`[WA inbound] instance=${instanceName} company=${instance.company?.name ?? companyId} triggerOnly=${triggerOnly} rulesCount=${rulesCount}`);

  let matchResult: MatchResult | null = null;

  if (rulesCount > 0) {
    matchResult = await matchKeywordRules(body, companyId);

    // Modo gatilho: se tem regras mas nenhuma bateu, ignora a mensagem
    if (!matchResult) {
      if (triggerOnly) {
        console.log(`[WA inbound] triggerOnly=true, sem match de keyword — salvando na inbox sem lead: phone=${phone}`);
        // Upsert da conversa (mesmo sem lead, queremos rastrear a conversa)
        const conv = await upsertConversation({
          companyId,
          phone,
          direction: "INBOUND",
          body,
          instanceId: instance.id,
          receivedAt,
        });
        // Salva a mensagem sem vincular a lead (upsert: idempotente)
        await safeCreateMessage({
          externalId: externalId ?? undefined,
          phone,
          body,
          direction: "INBOUND",
          processed: false,
          rawPayload: rawPayload ? (rawPayload as any) : undefined,
          companyId,
          instanceId: instance.id,
          conversationId: conv.id,
          ...(mediaBase64 ? { mediaBase64, mediaType: mediaType ?? null } : {}),
        });
        // Persiste o pushName para aparecer na lista de conversas mesmo sem lead
        if (contactName) await saveWAContactName(phone, contactName, companyId);
        return null;
      }
      // Se não é triggerOnly mas tem regras, cria lead NEW sem campanha
      matchResult = { status: LeadStatus.NEW, campaignId: null };
    }
  }
  // Se matchResult ainda é null → empresa sem regras

  // Verificar se já existe lead com este telefone nesta empresa
  // (se tem campaignId, prioriza o lead da mesma campanha)
  let lead = await prisma.lead.findFirst({
    where: {
      phone,
      companyId,
      ...(matchResult?.campaignId ? { campaignId: matchResult.campaignId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  if (!lead && !matchResult) {
    // Sem regras e sem lead existente → salva na caixa de entrada sem vincular a lead
    console.log(`[WA] Mensagem salva na caixa de entrada (sem lead): ${phone}`);
    const conv = await upsertConversation({
      companyId,
      phone,
      direction: "INBOUND",
      body,
      instanceId: instance.id,
      receivedAt,
    });
    await safeCreateMessage({
      externalId: externalId ?? undefined,
      phone,
      body,
      direction: "INBOUND",
      processed: false,
      rawPayload: rawPayload ? (rawPayload as any) : undefined,
      companyId,
      instanceId: instance.id,
      conversationId: conv.id,
      ...(mediaBase64 ? { mediaBase64, mediaType: mediaType ?? null } : {}),
    });
    // Persiste o pushName para aparecer na lista de conversas mesmo sem lead
    if (contactName) await saveWAContactName(phone, contactName, companyId);
    return null;
  }

  // Neste ponto: lead existe OU matchResult existe (ou ambos)
  // Se matchResult é null mas lead existe → usamos o status atual do lead
  const identifiedAs = matchResult?.status ?? lead!.status;
  const campaignId = matchResult?.campaignId ?? null;

  if (!lead) {
    // Keyword match sem lead existente → criar lead
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
    const needsStatusUpdate = matchResult ? shouldUpgradeStatus(lead.status, identifiedAs) : false;

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

  // Upsert da Conversation — fonte da verdade do status de atendimento
  // (substitui o antigo Lead.attendanceStatus = "WAITING")
  const conv = await upsertConversation({
    companyId,
    phone,
    direction: "INBOUND",
    body,
    instanceId: instance.id,
    receivedAt,
  });

  // Vincula o Lead à Conversation se ainda não estiver
  if (lead.conversationId !== conv.id) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { conversationId: conv.id },
    }).catch(() => {/* não crítico */});
  }

  // Persistir pushName no CompanyContact para aparecer nas buscas/filtros da inbox
  // (Lead.name tem prioridade na UI; isto é o fallback e serve de indexação)
  if (contactName) await saveWAContactName(phone, contactName, companyId);

  // Salvar a mensagem (upsert: idempotente mesmo com webhooks duplicados)
  const message = await safeCreateMessage({
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
    conversationId: conv.id,
    ...(receivedAt ? { receivedAt } : {}),
    ...(quotedId ? { quotedId, quotedBody: quotedBody ?? null } : {}),
    ...(mediaBase64 ? { mediaBase64, mediaType: mediaType ?? null } : {}),
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
