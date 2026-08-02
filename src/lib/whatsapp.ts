import { Prisma, LeadStatus, MessageDir, ConversationStatus, ActivityType } from "@/generated/prisma";
import { prisma } from "./prisma";

// Janela em que mensagens "terminais" (obrigado/emoji/blz) pós-finalização
// NÃO reabrem o atendimento. Após esse prazo, qualquer INBOUND reabre normal.
const TERMINAL_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

const TERMINAL_PHRASES = new Set([
  "obrigado", "obrigada", "obg", "obgg", "brigado", "brigada", "agradeco", "agradecido", "agradecida",
  "valeu", "valew", "vlw", "vlww", "vlwww",
  "blz", "beleza", "blzz",
  "ok", "okay", "okey", "oks", "ook",
  "tmj", "tamo junto",
  "tks", "thanks", "thx", "ty",
  "ta", "tah", "ta bom", "ta bem", "tudo bem", "tudo certo",
  "fechou", "fechado", "perfeito", "perfeita", "top", "show", "showw",
  "ate mais", "ate logo", "ate", "abracos", "abraco", "abs",
]);

// Palavras "filler" que aparecem em mensagens curtas de agradecimento mas
// não desqualificam como terminal: "obrigado pela ajuda", "valeu mesmo cara".
const TERMINAL_FILLERS = new Set([
  "pela", "pelo", "pelas", "pelos", "muito", "muita", "mesmo", "mesma",
  "cara", "amigo", "amiga", "gente", "irmao", "irma", "mano", "mana",
  "demais", "ajuda", "atencao", "viu", "rapaz", "moco", "moca",
  "entao", "entendi", "compreendi",
]);

// Palavras que indicam pergunta / novo assunto / saudação. Se aparecer
// alguma dessas, NÃO é terminal — provavelmente é continuação.
const INTENT_KEYWORDS = new Set([
  "como", "quando", "onde", "qual", "quanto", "porque", "pq",
  "preciso", "preciso?", "queria", "vou", "podem", "pode", "poderia",
  "tem", "tenho", "teria", "duvida", "pergunta", "problema", "erro",
  "ola", "oi", "alguem", "mais", "outra", "outro",
]);
const INTENT_PHRASES = ["bom dia", "boa tarde", "boa noite", "por que", "uma duvida"];

function normalizeForMatch(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[!.,?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isOnlyEmojiOrPunctuation(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return false;
  return /^[\s\p{Extended_Pictographic}‍️\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}!.,?;:]+$/u.test(trimmed);
}

/**
 * Detecta mensagem "terminal" — agradecimento curto, emoji ou confirmação que
 * não exige novo atendimento. Usado pra evitar reabrir conversa CLOSED quando
 * cliente manda só "valeu", "👍", "obrigado pela ajuda".
 *
 * Regras (em ordem):
 *   1. Vazio ou >30 chars → não-terminal
 *   2. Tem "?" → não-terminal (pergunta)
 *   3. Só emoji/pontuação → terminal
 *   4. Tem keyword de intenção (preciso, como, oi, "boa tarde", "uma dúvida"…) → não-terminal
 *   5. Frase exata no whitelist → terminal
 *   6. Todos os tokens são terminais ou fillers ("obrigado pela ajuda") → terminal
 *   7. ≤25 chars + ao menos 1 token terminal → terminal ("valeu cara")
 */
export function isTerminalMessage(body: string): boolean {
  if (!body) return false;
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > 30) return false;
  if (trimmed.includes("?")) return false;
  if (isOnlyEmojiOrPunctuation(trimmed)) return true;
  const norm = normalizeForMatch(trimmed);
  if (!norm) return false;
  if (INTENT_PHRASES.some((p) => norm.includes(p))) return false;
  if (TERMINAL_PHRASES.has(norm)) return true;
  const tokens = norm.split(" ").filter(Boolean);
  if (tokens.length === 0 || tokens.length > 5) return false;
  if (tokens.some((t) => INTENT_KEYWORDS.has(t))) return false;
  // Caso 1: todos os tokens são terminais ou fillers
  if (tokens.every((t) => TERMINAL_PHRASES.has(t) || TERMINAL_FILLERS.has(t))) {
    // Pelo menos um token terminal de fato (não 100% filler)
    if (tokens.some((t) => TERMINAL_PHRASES.has(t))) return true;
  }
  // Caso 2: mensagem curta (≤25 chars) com pelo menos 1 token terminal
  if (trimmed.length <= 25 && tokens.some((t) => TERMINAL_PHRASES.has(t))) return true;
  return false;
}

/** Snapshot mínimo da Conversation existente, suficiente pra decidir transições. */
export type ExistingConversationSnapshot = {
  status: ConversationStatus;
  scheduledReturnAt: Date | null;
  assigneeId: string | null;
  closedAt: Date | null;
};

/** Plano de mudança que `upsertConversation` aplica via Prisma. */
export type ConversationDecision = {
  newStatus: ConversationStatus;
  statusChanged: boolean;
  isTerminalAfterClose: boolean;
  closingScheduled: boolean;
  /** Quando true, NÃO limpa closedAt (mantém a conversa CLOSED + closedAt original). */
  preserveClosedAt: boolean;
  /** Logs de Activity que devem ser criados em conjunto. */
  activities: {
    reopened: boolean;
    terminalReply: boolean;
    scheduledClosed: "ontime" | "late" | null;
  };
};

/**
 * Decide a transição de status + side effects pra um upsert de Conversa,
 * dado o snapshot da existente (ou null se nova) e o payload da mensagem.
 *
 * Função PURA — não toca em DB, não chama gamificação. Toda a regra de
 * transição vive aqui, então o simulador (`scripts/test-messaging-flow.ts`)
 * exercita exatamente o mesmo código que o webhook usa em produção.
 *
 * Regras:
 *   - INBOUND + CLOSED + mensagem terminal (até 24h) → mantém CLOSED
 *   - INBOUND → OPEN (precisa resposta)
 *   - OUTBOUND + SCHEDULED existente → mantém SCHEDULED (follow-up não quebra)
 *   - OUTBOUND → WAITING_CUSTOMER
 */
export function decideConversationUpdate(args: {
  direction: MessageDir;
  body: string;
  now: Date;
  existing: ExistingConversationSnapshot | null;
}): ConversationDecision {
  const { direction, body, now, existing } = args;

  const closingScheduled =
    direction === "INBOUND" &&
    existing?.status === "SCHEDULED" &&
    !!existing.scheduledReturnAt;

  const isTerminalAfterClose =
    direction === "INBOUND" &&
    existing?.status === "CLOSED" &&
    !!existing.closedAt &&
    (now.getTime() - existing.closedAt.getTime()) < TERMINAL_REPLY_WINDOW_MS &&
    isTerminalMessage(body);

  let newStatus: ConversationStatus;
  if (isTerminalAfterClose) {
    newStatus = "CLOSED";
  } else if (direction === "INBOUND") {
    newStatus = "OPEN";
  } else if (existing?.status === "SCHEDULED") {
    newStatus = "SCHEDULED";
  } else {
    newStatus = "WAITING_CUSTOMER";
  }

  const statusChanged = !existing || existing.status !== newStatus;
  const reopened = !!existing && existing.status === "CLOSED" && newStatus === "OPEN";

  let scheduledClosed: "ontime" | "late" | null = null;
  if (closingScheduled && existing) {
    scheduledClosed = existing.scheduledReturnAt && existing.scheduledReturnAt > now ? "ontime" : "late";
  }

  return {
    newStatus,
    statusChanged,
    isTerminalAfterClose,
    closingScheduled,
    preserveClosedAt: isTerminalAfterClose,
    activities: { reopened, terminalReply: isTerminalAfterClose, scheduledClosed },
  };
}

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
 *     Bola está com a gente, mesmo se IN_PROGRESS ou WAITING_CUSTOMER antes.
 *   ─ OUTBOUND chegando (atendente respondeu) ─
 *     SEMPRE vai para WAITING_CUSTOMER (esperando cliente). Antes era IN_PROGRESS,
 *     mas IN_PROGRESS faz mais sentido para "atendente assumiu mas ainda não
 *     respondeu" (botão Pegar). Quando responde → WAITING_CUSTOMER.
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
    select: {
      id: true, status: true, firstResponseAt: true, setorId: true,
      // scheduledReturnAt / assigneeId pra encerrar agendamento quando cliente
      // responde antes do prazo (pontuar RETORNO_ANTECIPADO + remover do calendário)
      scheduledReturnAt: true, assigneeId: true,
      // closedAt pra detector de mensagem terminal pós-finalização
      closedAt: true,
    },
  });

  // Decisão pura — todas as regras de transição estão em decideConversationUpdate.
  const decision = decideConversationUpdate({
    direction,
    body,
    now,
    existing: existing
      ? {
          status: existing.status,
          scheduledReturnAt: existing.scheduledReturnAt,
          assigneeId: existing.assigneeId,
          closedAt: existing.closedAt,
        }
      : null,
  });
  const { newStatus, statusChanged, isTerminalAfterClose, closingScheduled } = decision;

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
      // Mensagem terminal pós-CLOSED: mantém status CLOSED e closedAt original.
      // Caso contrário, qualquer INBOUND reabre a conversa (closedAt = null).
      ...(isTerminalAfterClose ? {} : { closedAt: null }),
      ...(direction === "INBOUND"
        ? { unreadCount: { increment: 1 } }
        : { unreadCount: 0 }),
      ...(direction === "OUTBOUND" && existing && !existing.firstResponseAt
        ? { firstResponseAt: now }
        : {}),
      // Cliente retornou antes ou no prazo — encerra agendamento pra sair do
      // calendário automaticamente.
      ...(closingScheduled ? { scheduledReturnAt: null, returnNote: null } : {}),
    },
    select: { id: true },
  });

  // Reativação do bot em novo ciclo: conversa CLOSED reaberta por INBOUND.
  // Fora do upsert porque é condicional ao valor atual de aiMode (só sai de
  // PAUSED_HUMAN → ACTIVE; OFF manual é respeitado).
  if (existing && existing.status === "CLOSED" && newStatus === "OPEN") {
    await prisma.conversation.updateMany({
      where: { id: conversation.id, aiMode: "PAUSED_HUMAN" },
      data: { aiMode: "ACTIVE", aiPausedAt: null },
    }).catch(() => {/* não crítico */});
  }

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

  // Log de mensagem terminal pós-finalização (não reabriu conversa).
  if (isTerminalAfterClose) {
    await prisma.activity.create({
      data: {
        type: ActivityType.STATUS_CHANGED,
        body: `Cliente respondeu pós-finalização (${bodyPreview.slice(0, 30)}) — atendimento mantido fechado`,
        meta: { terminalReply: true } as Prisma.InputJsonValue,
        conversationId: conversation.id,
        companyId,
      },
    }).catch(() => {/* não crítico */});
  }

  // Cliente retornou antes do prazo? Loga + pontua RETORNO_ANTECIPADO pro
  // assignee se a resposta veio antes da data agendada. Se já passou da data,
  // só limpa silenciosamente (saiu do calendário) sem dar ponto.
  if (closingScheduled && existing) {
    const onTime = existing.scheduledReturnAt && existing.scheduledReturnAt > now;
    await prisma.activity.create({
      data: {
        // Sem enum dedicado pra "agendamento concluído" — usa STATUS_CHANGED
        // (o status saiu de SCHEDULED → OPEN). Body explica o motivo.
        type: ActivityType.STATUS_CHANGED,
        body: onTime
          ? "Cliente retornou antes do prazo agendado — agendamento encerrado"
          : "Cliente retornou após o prazo agendado — agendamento encerrado",
        conversationId: conversation.id,
        companyId,
      },
    }).catch(() => {/* não crítico */});
    if (onTime && existing.assigneeId) {
      // import dinâmico pra evitar ciclo (gamification importa de prisma)
      const { addScoreOnce } = await import("./gamification");
      void addScoreOnce(existing.assigneeId, companyId, "RETORNO_ANTECIPADO", conversation.id).catch(() => {});
    }
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
  // Espelha o "agendamento encerrado" no Lead.expectedReturnAt — algumas
  // views (Meu Dia leadsFollowUp) ainda filtram por expectedReturnAt.
  if (closingScheduled) {
    await prisma.lead.updateMany({
      where: { conversationId: conversation.id, expectedReturnAt: { not: null } },
      data:  { expectedReturnAt: null },
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
  // @lid (WhatsApp Business — identidade anonimizada): o "número" não bate
  // com o telefone real da instância. Resolve via phone_alias se já mesclado.
  let resolved = phone;
  if (phone.includes("@lid")) {
    const alias = await prisma.setting.findUnique({
      where: { key: `phone_alias:${companyId}:${phone}` },
    }).catch(() => null);
    if (alias?.value) resolved = alias.value;
  }
  const variants = phoneVariants(resolved);
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
 * Retorna true se o pushName do participante bate com o nome de exibição
 * de alguma instância da empresa. Fallback pra quando o participantPhone
 * vem em formato que não casa (@lid sem alias, etc.) — o pushName de quem
 * envia é o nome configurado no WhatsApp da própria instância.
 */
async function isNameOurInstance(name: string | null | undefined, companyId: string): Promise<boolean> {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return false;
  const found = await prisma.whatsappInstance.findFirst({
    where: {
      companyId,
      OR: [
        { instanceName: { equals: trimmed, mode: "insensitive" } },
        { label:        { equals: trimmed, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  }).catch(() => null);
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
  const lowerTrimmed = lower.trim();

  const rules = await prisma.keywordRule.findMany({
    where: { companyId },
    orderBy: { priority: "desc" },
  });

  for (const rule of rules) {
    const needle = rule.keyword.toLowerCase();
    const hit = rule.matchMode === "EXACT"
      ? lowerTrimmed === needle
      : lower.includes(needle);
    if (hit) {
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
  // Autoritativo: Evolution marcou key.fromMe. Quando true, a mensagem é
  // nossa mesmo que a detecção por participantPhone/nome falhe (ex: @lid).
  fromMe?: boolean;
}) {
  const { instanceName, phone, body, externalId, rawPayload, contactName, participantPhone, participantName, receivedAt, quotedId, quotedBody, mediaBase64, mediaType, fromMe } = payload;

  // Log de entrada — visível nos logs do servidor (Railway/Vercel)
  console.log(`[WA inbound] instance=${instanceName} phone=${phone} externalId=${externalId ?? "?"} body="${body.slice(0, 60)}"`);

  // Mensagens de grupo e @lid (identidade anônima WhatsApp Business) → salvar na inbox, sem criar lead
  if (phone.includes("@g.us") || phone.includes("@lid")) {
    const instance = await prisma.whatsappInstance.findFirst({ where: { instanceName } });
    if (!instance) return null;

    // Filtro de RECEPTORA de grupos: se a empresa designou uma instância
    // receptora, só ela persiste mensagens de grupo (@g.us). As demais seguem
    // ON (sincronizadas p/ enviar sem "Aguardando mensagem"), mas seus webhooks
    // de grupo são descartados aqui — evita duplicar contato/atribuição quando
    // várias instâncias estão nos mesmos grupos. O outbound de quem responde
    // continua sendo gravado pelo endpoint de envio (+ dedup por externalId),
    // então nada se perde. Só vale p/ @g.us — @lid segue o fluxo abaixo.
    // Sem nenhuma receptora marcada: comportamento antigo (processa tudo).
    if (phone.includes("@g.us")) {
      const receiverCount = await prisma.whatsappInstance.count({
        where: { companyId: instance.companyId, groupReceiver: true },
      });
      if (receiverCount > 0 && !(instance as any).groupReceiver) {
        console.log(`[WA inbound] grupo ignorado: "${instanceName}" não é a receptora de grupos da empresa`);
        return null;
      }
    }

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
    //
    // Sinais, em ordem de confiança:
    //  1) fromMe — Evolution confirmou que a mensagem é nossa (autoritativo)
    //  2) participantPhone bate com WhatsappInstance.phone (resolve @lid via alias)
    //  3) participantName (pushName) bate com instanceName/label da instância
    //     — fallback pra quando o telefone não casa (instância sem phone
    //     salvo, @lid sem alias, formato divergente).
    const isOurParticipant =
      fromMe === true ||
      (participantPhone ? await isPhoneOurInstance(participantPhone, instance.companyId) : false) ||
      (await isNameOurInstance(participantName, instance.companyId));
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
        // Agente autônomo — agenda processamento com debounce (guards no motor).
        // Import dinâmico evita ciclo (auto-agent importa upsertConversation daqui).
        void import("./auto-agent").then(({ scheduleAutoAgent }) => scheduleAutoAgent(conv.id)).catch(() => {});
        return null;
      }
      // Se não é triggerOnly mas tem regras, cria lead NEW sem campanha
      matchResult = { status: LeadStatus.NEW, campaignId: null };
    }
  }
  // Se matchResult ainda é null → empresa sem regras

  // ── Detectar "(ref: TOKEN)" no corpo da mensagem ───────────────────────────
  // Quando o cliente clica no botão "Solicitar via WhatsApp" no email de
  // campanha, o link wa.me vem com a mensagem pré-preenchida contendo o
  // token do diagnóstico do lead. Aqui reconhecemos esse token e linkamos
  // a conversa de volta ao lead — mesmo que o phone do remetente seja
  // diferente do Lead.phone original.
  const refMatch = body.match(/\(ref:\s*([a-zA-Z0-9_-]{6,})\s*\)/i);
  if (refMatch) {
    const refToken = refMatch[1];
    const refLead = await prisma.lead.findFirst({
      where: { diagnosisToken: refToken, companyId },
      select: { id: true, phone: true, name: true, pipeline: true },
    });
    if (refLead && refLead.phone !== phone) {
      console.log(`[WA inbound] ref token "${refToken}" → atualizando lead ${refLead.id} (phone ${refLead.phone} → ${phone})`);
      await prisma.lead.update({
        where: { id: refLead.id },
        data: { phone },
      }).catch(() => null);
      await prisma.activity.create({
        data: {
          type: "NOTE_ADDED",
          leadId: refLead.id,
          companyId,
          authorName: "Sistema",
          body: `📲 Lead respondeu via WhatsApp solicitando avaliação completa (vindo do email de diagnóstico)`,
          meta: { kind: "wa_diagnostic_request", refToken, oldPhone: refLead.phone, newPhone: phone },
        },
      }).catch(() => null);
    } else if (refLead) {
      // Phone já bate — só registra a Activity
      await prisma.activity.create({
        data: {
          type: "NOTE_ADDED",
          leadId: refLead.id,
          companyId,
          authorName: "Sistema",
          body: `📲 Lead solicitou avaliação completa via WhatsApp (vindo do email de diagnóstico)`,
          meta: { kind: "wa_diagnostic_request", refToken },
        },
      }).catch(() => null);
    }
  }

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
    // Agente autônomo — agenda processamento com debounce (guards no motor).
    void import("./auto-agent").then(({ scheduleAutoAgent }) => scheduleAutoAgent(conv.id)).catch(() => {});
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

  // Push notification — só pra quem é responsável pela conversa.
  // fire-and-forget, nunca bloqueia o webhook.
  void (async () => {
    try {
      const c = await prisma.conversation.findUnique({
        where: { id: conv.id },
        select: { assigneeId: true },
      });
      if (c?.assigneeId) {
        await notifyInboundMessage({
          assigneeId: c.assigneeId,
          contactName: lead.name ?? contactName ?? phone,
          body,
          mediaType: mediaType ?? null,
          url: `/whatsapp?abrir=${encodeURIComponent(phone)}`,
          conversationId: conv.id,
        });
      }
    } catch { /* nunca propaga */ }
  })();

  // Agente autônomo — agenda processamento com debounce (guards no motor).
  void import("./auto-agent").then(({ scheduleAutoAgent }) => scheduleAutoAgent(conv.id)).catch(() => {});

  return { lead, message, identifiedAs, campaignId };
}

async function notifyInboundMessage(args: {
  assigneeId: string;
  contactName: string;
  body: string;
  mediaType: string | null;
  url: string;
  conversationId: string;
}) {
  try {
    const { sendPushToUser } = await import("./push");
    const preview = args.body?.trim()
      ? (args.body.length > 80 ? args.body.slice(0, 80) + "…" : args.body)
      : (args.mediaType?.startsWith("image") ? "📷 Enviou uma imagem"
        : args.mediaType?.startsWith("audio") ? "🎤 Enviou um áudio"
        : "📎 Enviou um anexo");
    await sendPushToUser(
      args.assigneeId,
      {
        title: `💬 ${args.contactName}`,
        body: preview,
        url: args.url,
        tag: `conv-${args.conversationId}`, // agrupa: várias mensagens viram 1 notificação
      },
      "newMessage"
    );
  } catch { /* nunca propaga */ }
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
