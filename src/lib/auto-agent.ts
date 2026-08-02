import { LeadStatus } from "@/generated/prisma";
import { prisma } from "./prisma";
import { runAssistant, getAssistantForInstance, getServicesCatalogBlock, type ChatMessage } from "./assistant";
import { evolutionSendText } from "./evolution";
import { upsertConversation } from "./whatsapp";
import { sendPushToUser } from "./push";

/**
 * Agente autônomo de atendimento (triagem).
 *
 * Fluxo: mensagem INBOUND chega no webhook → scheduleAutoAgent() agenda o
 * processamento com debounce (mensagens picadas viram UMA resposta) →
 * runAutoAgentNow() monta o prompt (manual + aprendizados + catálogo +
 * histórico), pede um JSON estruturado à IA e executa a ação:
 *
 *   NONE      → só responde e segue conversando/qualificando
 *   <intent>  → rota cadastrada em AssistantRoute (ex.: COMERCIAL, ATENDIMENTO):
 *               move a conversa pro setor, opcionalmente cria/atualiza Lead,
 *               registra nota de triagem, notifica o time e SILENCIA o bot
 *   HANDOFF   → contato pediu humano (ou a IA não sabe): silencia e notifica
 *
 * O bot NUNCA responde: grupos, conversas com aiMode != ACTIVE (humano assumiu
 * ou bot desligado) e instâncias sem agente autoRespond. Toda chamada passa
 * pelo runAssistant() → cota mensal da empresa + AiUsageLog valem aqui.
 */

const DEBOUNCE_MS = 10_000;
const HISTORY_LIMIT = 30;
const MAX_REPLY_TOKENS = 500;

// Debounce por conversa. Vive em globalThis pra sobreviver ao HMR do dev.
// Servidor único (standalone) — suficiente pra Fase 1; se um dia houver
// réplicas, trocar por fila (pg-boss).
const timers: Map<string, ReturnType<typeof setTimeout>> =
  (globalThis as any).__autoAgentTimers ?? new Map();
(globalThis as any).__autoAgentTimers = timers;

/**
 * Agenda o processamento da conversa com debounce. Chamar a cada INBOUND
 * (o webhook chama; é barato — os guards pesados rodam só quando dispara).
 */
export function scheduleAutoAgent(conversationId: string): void {
  const existing = timers.get(conversationId);
  if (existing) clearTimeout(existing);
  timers.set(
    conversationId,
    setTimeout(() => {
      timers.delete(conversationId);
      runAutoAgentNow(conversationId).catch((err) =>
        console.error(`[AutoAgent] erro conv=${conversationId}:`, err)
      );
    }, DEBOUNCE_MS)
  );
}

/**
 * Pausa o bot numa conversa (humano assumiu ou desligado manualmente).
 * Idempotente e nunca lança — seguro pra chamar de qualquer fluxo de envio.
 */
export async function pauseBot(
  conversationId: string,
  mode: "PAUSED_HUMAN" | "OFF" = "PAUSED_HUMAN"
): Promise<void> {
  const t = timers.get(conversationId);
  if (t) {
    clearTimeout(t);
    timers.delete(conversationId);
  }
  await prisma.conversation
    .updateMany({
      where: { id: conversationId, aiMode: "ACTIVE" },
      data: { aiMode: mode, aiPausedAt: new Date() },
    })
    .catch(() => {/* nunca propaga */});
}

/** Reativa o bot numa conversa (botão da Inbox). */
export async function resumeBot(conversationId: string): Promise<void> {
  await prisma.conversation
    .updateMany({
      where: { id: conversationId },
      data: { aiMode: "ACTIVE", aiPausedAt: null },
    })
    .catch(() => {/* nunca propaga */});
}

// ── Núcleo ────────────────────────────────────────────────────────────────────

interface AgentDecision {
  reply: string | null;
  action: string; // "NONE" | "HANDOFF" | intent de AssistantRoute
  resumo: string | null;
}

/**
 * Extrai o JSON da resposta da IA de forma tolerante (com/sem cerca de código,
 * texto em volta). Retorna null se não houver JSON utilizável.
 */
function parseDecision(raw: string): AgentDecision | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    const reply = typeof obj.reply === "string" && obj.reply.trim() ? obj.reply.trim() : null;
    const action = typeof obj.action === "string" && obj.action.trim() ? obj.action.trim().toUpperCase() : "NONE";
    const resumo = typeof obj.resumo === "string" && obj.resumo.trim() ? obj.resumo.trim() : null;
    return { reply, action, resumo };
  } catch {
    return null;
  }
}

function buildSystemPrompt(args: {
  manual: string;
  learnings: string | null;
  schedulingLink: string | null;
  qualificationChecklist: string | null;
  servicesBlock: string;
  routes: { intent: string; label: string | null; setorName: string }[];
}): string {
  const { manual, learnings, schedulingLink, qualificationChecklist, servicesBlock, routes } = args;

  const routeLines = routes
    .map((r) => `- "${r.intent}" → encaminha pro setor ${r.label ?? r.setorName}. Use quando o contato foi identificado/qualificado como esse caso.`)
    .join("\n");

  const checklistItems = (qualificationChecklist ?? "")
    .split("\n")
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter(Boolean);

  const parts: string[] = [];

  parts.push(`# PAPEL
Você é um atendente da empresa respondendo mensagens de WhatsApp. Converse de forma natural, calorosa e breve (estilo WhatsApp: mensagens curtas, no máximo ~3 frases, UMA pergunta por vez). Nunca invente informações, preços ou prazos que não estejam no manual/catálogo abaixo.

Identidade:
- NÃO se apresente como "assistente virtual", "IA", "bot" ou "atendimento automático". Você é simplesmente alguém do time — desenrole a conversa como uma pessoa faria.
- Não use frases robóticas ("digite 1 para...", "em que posso ajudá-lo hoje?"). Fale como gente.
- Se o contato perguntar DIRETAMENTE se você é um robô/IA, NÃO minta: responda leve ("aqui é do time da empresa 🙂 vou te passar com alguém agora") e use action "HANDOFF".`);

  parts.push(`# MANUAL DO AGENTE (siga à risca)\n${manual.trim()}`);

  if (learnings?.trim()) {
    parts.push(`# APRENDIZADOS (correções e orientações acumuladas — têm prioridade sobre o manual em caso de conflito)\n${learnings.trim()}`);
  }

  if (checklistItems.length) {
    parts.push(`# INFORMAÇÕES OBRIGATÓRIAS (colete TODAS antes de agendar/encaminhar pra reunião)
${checklistItems.map((c) => `- ${c}`).join("\n")}

Regras de coleta:
- Colete no meio da conversa, de forma NATURAL — uma informação por mensagem, encaixada no assunto. NUNCA despeje as perguntas como formulário/questionário.
- O que o contato já disse espontaneamente conta como coletado — não pergunte de novo.
- Só ofereça agendar reunião/horário depois que TODAS estiverem coletadas.
- Inclua todas as respostas coletadas no campo "resumo" ao encaminhar.`);
  }

  if (schedulingLink?.trim()) {
    parts.push(`# LINK DE AGENDAMENTO\nQuando for agendar, envie EXATAMENTE esta URL: ${schedulingLink.trim()}`);
  }

  if (servicesBlock) parts.push(servicesBlock.trim());

  parts.push(`# SUA MISSÃO NESTA CONVERSA
1. Entender o que o contato quer (interprete livremente — não há menu de opções).
2. Qualificar com perguntas naturais, UMA por vez${checklistItems.length ? " (priorize as INFORMAÇÕES OBRIGATÓRIAS acima)" : ""}.
3. Quando estiver claro pra qual time vai, encaminhe usando a action correta.

# ACTIONS DISPONÍVEIS
- "NONE" → continuar conversando (ainda entendendo/qualificando).
${routeLines}
- "HANDOFF" → o contato pediu pra falar com uma pessoa, está irritado, ou você NÃO sabe responder com segurança. Nunca insista em segurar alguém que pediu humano.

# REGRAS DE ENCAMINHAMENTO
- Ao encaminhar (qualquer action ≠ NONE), o "reply" deve avisar o contato de forma simpática que o time certo vai assumir a conversa. Depois disso você para de responder.
- Se o contato mandou áudio, imagem ou arquivo (aparece como "🎵 Áudio", "🖼️ Imagem", "📎 ..." no histórico), diga educadamente que por aqui você atende por texto e peça pra escrever.

# FORMATO DA RESPOSTA (obrigatório)
Responda SOMENTE com um JSON válido, sem texto fora dele, neste formato:
{"reply": "mensagem pro contato (ou null se não deve responder nada)", "action": "NONE", "resumo": "1 frase objetiva: quem é o contato e o que quer"}
O campo "resumo" é interno (o time lê) — sempre preencha da melhor forma possível.`);

  return parts.join("\n\n");
}

/**
 * Processa a conversa AGORA (chamado pelo debounce; exportado também pra
 * testes/diagnóstico). Todos os guards vivem aqui.
 */
export async function runAutoAgentNow(conversationId: string): Promise<
  | { ok: true; action: string; replied: boolean }
  | { ok: false; skipped: string }
> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true, phone: true, isGroup: true, status: true, aiMode: true,
      companyId: true, setorId: true, assigneeId: true,
    },
  });

  if (!conv) return { ok: false, skipped: "conv_not_found" };
  if (conv.isGroup) return { ok: false, skipped: "group" };
  if (conv.aiMode !== "ACTIVE") return { ok: false, skipped: `aiMode_${conv.aiMode}` };
  if (conv.status === "CLOSED") return { ok: false, skipped: "closed" };

  // Última mensagem precisa ser INBOUND — se humano (ou o próprio bot) já
  // respondeu depois dela, não há o que fazer.
  const last = await prisma.message.findFirst({
    where: { conversationId: conv.id },
    orderBy: { receivedAt: "desc" },
    select: { id: true, direction: true, instanceId: true, receivedAt: true },
  });
  if (!last || last.direction !== "INBOUND") return { ok: false, skipped: "last_not_inbound" };
  if (!last.instanceId) return { ok: false, skipped: "no_instance" };

  const instance = await prisma.whatsappInstance.findUnique({
    where: { id: last.instanceId },
    select: { id: true, instanceName: true, instanceToken: true, status: true },
  });
  if (!instance) return { ok: false, skipped: "instance_not_found" };

  // Agente autônomo da instância (independe do type — roteamento por número)
  const assistant = await getAssistantForInstance(conv.companyId, instance.id);
  if (!assistant || !assistant.isActive || !(assistant as any).autoRespond) {
    return { ok: false, skipped: "no_auto_assistant" };
  }

  const routes = await prisma.assistantRoute.findMany({
    where: { assistantId: assistant.id },
    include: { setor: { select: { id: true, name: true } } },
  });

  // Histórico recente (ordem cronológica)
  const history = await prisma.message.findMany({
    where: { conversationId: conv.id },
    orderBy: { receivedAt: "desc" },
    take: HISTORY_LIMIT,
    select: { body: true, direction: true, receivedAt: true },
  });
  history.reverse();

  const servicesBlock = await getServicesCatalogBlock(conv.companyId);

  const system = buildSystemPrompt({
    manual: assistant.manual,
    learnings: (assistant as any).learnings ?? null,
    schedulingLink: assistant.schedulingLink,
    qualificationChecklist: (assistant as any).qualificationChecklist ?? null,
    servicesBlock,
    routes: routes.map((r) => ({ intent: r.intent, label: r.label, setorName: r.setor.name })),
  });

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...history.map((m): ChatMessage => ({
      role: m.direction === "INBOUND" ? "user" : "assistant",
      content: m.body,
    })),
  ];

  const result = await runAssistant({
    companyId: conv.companyId,
    endpoint: "auto-agent",
    messages,
    assistantId: assistant.id,
    model: assistant.model,
    temperature: assistant.temperature,
    maxTokens: MAX_REPLY_TOKENS,
  });

  if (!result.ok) {
    // Cota/config/erro → silêncio (nunca expor erro interno ao contato).
    console.warn(`[AutoAgent] runAssistant falhou conv=${conv.id}: ${result.code} — ${result.error}`);
    return { ok: false, skipped: `ai_${result.code}` };
  }

  const decision = parseDecision(result.text);
  if (!decision) {
    console.warn(`[AutoAgent] resposta sem JSON utilizável conv=${conv.id}: "${result.text.slice(0, 200)}"`);
    return { ok: false, skipped: "bad_json" };
  }

  // Race check: se durante a chamada de IA chegou resposta de humano (ou o bot
  // foi pausado), descarta a resposta gerada.
  const fresh = await prisma.conversation.findUnique({
    where: { id: conv.id },
    select: { aiMode: true },
  });
  if (fresh?.aiMode !== "ACTIVE") return { ok: false, skipped: "paused_during_ai" };
  const newer = await prisma.message.findFirst({
    where: { conversationId: conv.id, direction: "OUTBOUND", receivedAt: { gt: last.receivedAt } },
    select: { id: true },
  });
  if (newer) return { ok: false, skipped: "human_replied_during_ai" };

  // 1) Enviar a resposta ao contato
  let replied = false;
  if (decision.reply) {
    try {
      const sendResult = await evolutionSendText(
        instance.instanceName,
        conv.phone,
        decision.reply,
        instance.instanceToken ?? null
      );
      // Prefixo "out-" no fallback: o webhook fromMe (eco do envio) reconhece
      // esse padrão e ATUALIZA o registro em vez de duplicar/pausar o bot.
      const externalId: string = sendResult?.key?.id ?? sendResult?.id ?? `out-${Date.now()}`;

      const updatedConv = await upsertConversation({
        companyId: conv.companyId,
        phone: conv.phone,
        direction: "OUTBOUND",
        body: decision.reply,
        instanceId: instance.id,
      });

      await prisma.message.create({
        data: {
          externalId,
          body: decision.reply,
          direction: "OUTBOUND",
          phone: conv.phone,
          instanceId: instance.id,
          companyId: conv.companyId,
          conversationId: updatedConv.id,
          ack: 1,
          // Marca de origem: mensagem gerada pelo agente autônomo (a UI pode
          // usar pra exibir o badge 🤖 sem precisar de campo novo).
          rawPayload: { autoAgent: true, assistantId: assistant.id } as any,
        },
      });
      replied = true;
    } catch (err) {
      console.error(`[AutoAgent] falha ao enviar resposta conv=${conv.id}:`, err);
      // Sem envio não faz sentido rotear "às cegas" — tenta de novo na próxima msg.
      return { ok: false, skipped: "send_failed" };
    }
  }

  // 2) Executar a action
  const action = decision.action;
  if (action !== "NONE") {
    const route = routes.find((r) => r.intent.toUpperCase() === action) ?? null;

    if (route) {
      await routeConversation({
        conversationId: conv.id,
        companyId: conv.companyId,
        phone: conv.phone,
        setorId: route.setorId,
        setorName: route.setor.name,
        createLead: route.createLead,
        resumo: decision.resumo,
      });
    } else if (action === "HANDOFF") {
      await handoffConversation({
        conversationId: conv.id,
        setorId: conv.setorId,
        resumo: decision.resumo,
        phone: conv.phone,
      });
    } else {
      // Action desconhecida → trata como HANDOFF defensivo (melhor um humano
      // olhar do que o bot travar a conversa).
      console.warn(`[AutoAgent] action desconhecida "${action}" conv=${conv.id} — tratando como HANDOFF`);
      await handoffConversation({
        conversationId: conv.id,
        setorId: conv.setorId,
        resumo: decision.resumo,
        phone: conv.phone,
      });
    }
  }

  return { ok: true, action, replied };
}

// ── Ações ─────────────────────────────────────────────────────────────────────

async function routeConversation(args: {
  conversationId: string;
  companyId: string;
  phone: string;
  setorId: string;
  setorName: string;
  createLead: boolean;
  resumo: string | null;
}): Promise<void> {
  const { conversationId, companyId, phone, setorId, setorName, createLead, resumo } = args;

  // Move pro setor, volta pra OPEN (aparece como "nova" pro time que assumiu)
  // e silencia o bot.
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      setorId,
      status: "OPEN",
      statusUpdatedAt: new Date(),
      aiMode: "PAUSED_HUMAN",
      aiPausedAt: new Date(),
    },
  });

  await prisma.conversationNote.create({
    data: {
      conversationId,
      authorName: "🤖 Agente IA",
      type: "SYSTEM",
      body: `Triagem automática → setor ${setorName}.${resumo ? `\nResumo: ${resumo}` : ""}`,
    },
  }).catch(() => {/* nota é acessório, nunca bloqueia */});

  // Lead no CRM (rota comercial)
  if (createLead) {
    try {
      let lead = await prisma.lead.findFirst({
        where: { phone, companyId },
        orderBy: { createdAt: "desc" },
      });
      if (!lead) {
        const firstStage = await prisma.pipelineStageConfig.findFirst({
          where: { companyId, pipeline: "LEADS" },
          orderBy: { order: "asc" },
        });
        lead = await prisma.lead.create({
          data: {
            phone,
            companyId,
            source: "ia-triagem",
            status: LeadStatus.NEW,
            pipeline: "LEADS",
            pipelineStage: firstStage?.name ?? null,
            conversationId,
          },
        });
      } else if (lead.conversationId !== conversationId) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { conversationId },
        }).catch(() => null);
      }
      if (resumo) {
        await prisma.activity.create({
          data: {
            type: "NOTE_ADDED",
            leadId: lead.id,
            companyId,
            authorName: "🤖 Agente IA",
            body: `Qualificação da triagem automática: ${resumo}`,
            meta: { kind: "auto_agent_qualification" },
          },
        }).catch(() => null);
      }
    } catch (err) {
      console.error(`[AutoAgent] falha ao criar lead conv=${conversationId}:`, err);
    }
  }

  await notifySetor(setorId, {
    title: `🤖 IA encaminhou um atendimento (${setorName})`,
    body: resumo ?? "Novo atendimento triado pela IA.",
    url: `/whatsapp?abrir=${encodeURIComponent(phone)}`,
    tag: `auto-agent-${conversationId}`,
  });
}

async function handoffConversation(args: {
  conversationId: string;
  setorId: string | null;
  resumo: string | null;
  phone: string;
}): Promise<void> {
  const { conversationId, setorId, resumo, phone } = args;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: "OPEN",
      statusUpdatedAt: new Date(),
      aiMode: "PAUSED_HUMAN",
      aiPausedAt: new Date(),
    },
  });

  await prisma.conversationNote.create({
    data: {
      conversationId,
      authorName: "🤖 Agente IA",
      type: "SYSTEM",
      body: `Passou pra atendimento humano.${resumo ? `\nResumo: ${resumo}` : ""}`,
    },
  }).catch(() => {/* acessório */});

  if (setorId) {
    await notifySetor(setorId, {
      title: "🤖 IA pediu atendimento humano",
      body: resumo ?? "Contato precisa de um atendente.",
      url: `/whatsapp?abrir=${encodeURIComponent(phone)}`,
      tag: `auto-agent-${conversationId}`,
    });
  }
}

async function notifySetor(
  setorId: string,
  payload: { title: string; body: string; url: string; tag: string }
): Promise<void> {
  try {
    const members = await prisma.setorUser.findMany({
      where: { setorId },
      select: { userId: true },
    });
    await Promise.all(
      members.map((m) => sendPushToUser(m.userId, payload, "newMessage"))
    );
  } catch {
    /* push é acessório — nunca propaga */
  }
}
