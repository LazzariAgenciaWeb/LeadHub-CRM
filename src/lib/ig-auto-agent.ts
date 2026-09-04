import { prisma } from "./prisma";
import { runAssistant, getServicesCatalogBlock, type ChatMessage } from "./assistant";
import {
  decryptAccountToken,
  getUserFollowStatus,
  sendMessageToUser,
  recordIgMessage,
  startDirectFollowGate,
} from "./instagram";

/**
 * Agente autônomo do Direct (Instagram) — irmão do auto-agent do WhatsApp.
 *
 * Fluxo: DM orgânica chega no webhook → scheduleIgAutoAgent() agenda com
 * debounce (mensagens picadas viram UMA resposta) → runIgAutoAgentNow() monta
 * o prompt (manual do agente + aprendizados + catálogo + histórico, incluindo
 * as DMs enviadas manualmente pela equipe via echo) e responde em bolhas curtas.
 *
 * Multi-tenant por construção: o agente vem de Assistant.igAccountId (vínculo
 * por conta de Instagram, igual ao instanceId do WhatsApp). Todo comportamento
 * comercial vive no manual editável da empresa — aqui só existe o esqueleto.
 *
 * O bot NUNCA responde quando: aiMode != ACTIVE (humano assumiu ou desligado),
 * há automação de palavra-chave em andamento pro contato (IgAutomationRun
 * aberto), a última mensagem do contato passou da janela de 24h da Meta, ou a
 * conta não tem agente ativo com autoRespond vinculado.
 */

export const IG_AUTO_AGENT_REV = "v6-limites";

const DEBOUNCE_MS = 12_000;
const HISTORY_LIMIT = 30;
const MAX_REPLY_TOKENS = 500;
const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const BUBBLE_DELAY_MS = 1_800;

// ─── Diagnóstico em memória (mesmo padrão do auto-agent do WhatsApp) ─────────
const recentRuns: Record<string, unknown>[] = (globalThis as any).__igAutoAgentRuns ?? [];
(globalThis as any).__igAutoAgentRuns = recentRuns;
export function getRecentIgAutoAgentRuns() {
  return recentRuns;
}
function recordRun(entry: Record<string, unknown>) {
  recentRuns.unshift({ ts: new Date().toISOString(), ...entry });
  if (recentRuns.length > 12) recentRuns.pop();
}

// ─── Debounce ────────────────────────────────────────────────────────────────
const pending: Map<string, ReturnType<typeof setTimeout>> =
  (globalThis as any).__igAutoAgentTimers ?? new Map();
(globalThis as any).__igAutoAgentTimers = pending;

/** Agenda o processamento da conversa (debounce). Chamar a cada DM orgânica. */
export function scheduleIgAutoAgent(conversationId: string): void {
  const prev = pending.get(conversationId);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    pending.delete(conversationId);
    runIgAutoAgentNow(conversationId).catch((e) =>
      console.error(`[IgAgent] run falhou conv=${conversationId}:`, e?.message),
    );
  }, DEBOUNCE_MS);
  pending.set(conversationId, t);
}

/**
 * Cancela um processamento agendado. Usado quando um humano responde primeiro
 * (echo OUT chega antes do debounce vencer) — o time chegou antes do bot.
 */
export function cancelIgAutoAgent(conversationId: string): void {
  const prev = pending.get(conversationId);
  if (prev) {
    clearTimeout(prev);
    pending.delete(conversationId);
  }
}

// ─── Prospecção: casar contato do Direct com Lead pelo @ ─────────────────────

function normalizeIgUsername(u: string | null | undefined): string | null {
  const s = (u ?? "").trim().replace(/^@/, "").toLowerCase();
  return s || null;
}

/** Lead da empresa cujo campo instagram casa com o @ do contato (best-effort). */
export async function findLeadByIgUsername(companyId: string, username: string | null | undefined) {
  const ig = normalizeIgUsername(username);
  if (!ig) return null;
  return prisma.lead.findFirst({
    where: { companyId, instagram: { equals: ig, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Prospect respondeu no Direct → vincula a conversa ao Lead (leadId) e, se
 * ainda está em PROSPECCAO, promove pra LEADS (primeira etapa) com atribuição.
 * Determinístico: roda no webhook, independente do agente responder ou não.
 * Mesmo padrão do clique no diagnóstico (/d/[token]).
 */
export async function promoteIgProspectOnReply(
  companyId: string,
  username: string | null | undefined,
  conversationId?: string | null,
): Promise<void> {
  const lead = await findLeadByIgUsername(companyId, username);
  if (!lead) return;

  // Vínculo conversa ↔ lead (backfill; idempotente).
  if (conversationId) {
    await prisma.igConversation
      .updateMany({ where: { id: conversationId, leadId: null }, data: { leadId: lead.id } })
      .catch(() => {});
  }

  if (lead.pipeline !== "PROSPECCAO") return;
  const firstStage = await prisma.pipelineStageConfig.findFirst({
    where: { companyId, pipeline: "LEADS" },
    orderBy: { order: "asc" },
    select: { name: true },
  });
  const stamp = `Respondeu no Direct em ${new Date().toLocaleDateString("pt-BR")}.`;
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      pipeline: "LEADS",
      pipelineStage: firstStage?.name ?? null,
      notes: lead.notes ? `${lead.notes}\n\n${stamp}` : stamp,
      promotedFromPipeline: "PROSPECCAO",
      promotedAt: new Date(),
      promotedReason: "direct_reply",
    },
  });
  console.log(`[IgAgent] prospect @${normalizeIgUsername(username)} promovido pra LEADS (lead ${lead.id})`);
}

// ─── Parser tolerante do JSON da IA ──────────────────────────────────────────
type AgentDecision = { reply: string[]; action: "NONE" | "HANDOFF" };

/**
 * O histórico marca as mensagens do time com "[equipe] " pra dar contexto ao
 * modelo — e o modelo imitava o padrão, mandando "[equipe] Beleza!" direto pro
 * cliente. Aqui a etiqueta é arrancada antes de qualquer envio (o prompt também
 * proíbe, mas isto é a garantia mecânica).
 */
function stripInternalTags(text: string): string {
  return text
    .replace(/^\s*[[(](?:equipe|time|atendente|agente|ia|bot)[\])]\s*:?\s*/i, "")
    .trim();
}

/** @ do Instagram dentro de link ou menção ("instagram.com/fulano", "@fulano"). */
function extractIgHandles(text: string): string[] {
  const handles = new Set<string>();
  const fromUrl = text.matchAll(/instagram\.com\/([A-Za-z0-9._]{2,30})/gi);
  for (const m of fromUrl) {
    const h = m[1].toLowerCase();
    if (!["p", "reel", "reels", "stories", "explore", "direct"].includes(h)) handles.add(h);
  }
  for (const m of text.matchAll(/(?:^|\s)@([A-Za-z0-9._]{2,30})/g)) handles.add(m[1].toLowerCase());
  return [...handles];
}

/** O contato aceitou a oferta que a equipe fez ("pode", "manda", "à vontade"…). */
function looksLikeAcceptance(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (t.length > 140) return false;
  // "pode chamar no whatsapp / liga pra mim / ta na bio" não é aceite do
  // diagnóstico — é redirecionamento de canal, tratado pelo manual.
  if (/\b(whats|whatsapp|zap|bio|liga|ligar|telefone|e-?mail|chama no)\b/.test(t)) return false;
  return /\b(pode|podes|pode sim|claro|manda|manda ai|pode mandar|quero|bora|vamos|sim|isso|aceito|topo|mostra|me mostra|adoraria|por favor|fico no aguardo|a vontade|fique a vontade|fica a vontade)\b/.test(t);
}

function parseDecision(raw: string): AgentDecision | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    const reply = Array.isArray(obj.reply)
      ? obj.reply.map((b: unknown) => stripInternalTags(String(b ?? ""))).filter(Boolean)
      : typeof obj.reply === "string" && obj.reply.trim()
        ? [stripInternalTags(obj.reply)].filter(Boolean)
        : [];
    const action = obj.action === "HANDOFF" ? "HANDOFF" : "NONE";
    return { reply: reply.slice(0, 3), action };
  } catch {
    return null;
  }
}

// ─── Motor ───────────────────────────────────────────────────────────────────
export async function runIgAutoAgentNow(conversationId: string): Promise<void> {
  const conv = await prisma.igConversation.findUnique({
    where: { id: conversationId },
    include: { account: true },
  });
  const skip = (reason: string, extra?: Record<string, unknown>) => {
    recordRun({ conv: conversationId, skip: reason, ...extra });
    console.log(`[IgAgent] skip conv=${conversationId}: ${reason}`);
  };

  if (!conv) return skip("conversa_inexistente");
  if (conv.channel !== "INSTAGRAM" || !conv.account) return skip("canal_nao_suportado");
  if (conv.aiMode !== "ACTIVE") return skip(`aiMode_${conv.aiMode}`);
  // Só responde quando a ÚLTIMA mensagem é do contato (se OUT depois do
  // agendamento, alguém — humano ou automação — já respondeu).
  if (conv.lastDirection !== "IN") return skip("ja_respondida");

  // Agente da conta (vínculo igAccountId; precisa estar ativo E em modo autônomo).
  const assistant = await prisma.assistant.findFirst({
    where: { companyId: conv.companyId, igAccountId: conv.accountId, isActive: true, autoRespond: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!assistant) return skip("sem_agente_vinculado");

  // Precedência: automação de palavra-chave em andamento é dona da conversa.
  const openRun = await prisma.igAutomationRun.findFirst({
    where: {
      accountId: conv.accountId!,
      igCommenterId: conv.participantId,
      status: { in: ["PENDING", "COMMENT_REPLIED", "DM_SENT", "AWAITING_FOLLOW"] },
    },
    select: { id: true },
  });
  if (openRun) return skip("automacao_em_andamento", { run: openRun.id });

  // Trava opcional: conversa que NASCEU de automação (isca, follow, link) não
  // é assumida pelo agente nem depois que a automação termina. Quem baixou
  // material não virou lead por isso — o time decide se puxa conversa.
  if ((assistant as any).skipAutomationConvos && conv.hadAutomation) {
    return skip("conversa_de_automacao");
  }

  const token = decryptAccountToken(conv.account.accessTokenEnc);
  if (!token) return skip("conta_sem_token");

  // Histórico (asc) + janela de 24h da Meta sobre a última mensagem do contato.
  const history = await prisma.igMessage.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { direction: true, source: true, text: true, createdAt: true },
  });
  history.reverse();
  const lastIn = [...history].reverse().find((m) => m.direction === "IN");
  if (!lastIn) return skip("sem_mensagem_do_contato");
  if (Date.now() - lastIn.createdAt.getTime() > WINDOW_24H_MS) return skip("fora_janela_24h");

  // Follow status (best-effort) — o manual da empresa decide o que fazer com isso.
  const follows = await getUserFollowStatus(conv.participantId, token);

  // FOLLOW-GATE: quando o contato aceita ver o diagnóstico mas ainda não segue,
  // quem pede o follow é a MESMA máquina das automações de post (checagem real
  // + botão "já te segui" + run AWAITING_FOLLOW) — não o texto improvisado do
  // modelo. Assim que o follow é confirmado, o agente é chamado de volta e
  // entrega. Sem gate: pedido some no meio da conversa e ninguém confere nada.
  if (follows === false && looksLikeAcceptance(lastIn.text ?? "")) {
    const gate = await startDirectFollowGate(
      conv.account,
      conv.participantId,
      conv.participantUsername ?? null,
      token,
    );
    if (gate === "ASKED") {
      recordRun({ conv: conv.id, gate: "follow_pedido_via_automacao" });
      console.log(`[IgAgent] follow-gate acionado conv=${conv.id} — agente aguarda o follow`);
      return;
    }
  }
  const followLine =
    follows === true ? "O contato JÁ SEGUE o perfil da empresa."
    : follows === false ? "O contato AINDA NÃO SEGUE o perfil da empresa."
    : "Não foi possível verificar se o contato segue o perfil.";

  // Dados do prospect levantados pela equipe (rotina de prospecção → webhook
  // de leads com o @). Usa o vínculo direto quando existe; senão casa pelo @
  // e faz o backfill do leadId.
  const lead = conv.leadId
    ? await prisma.lead.findUnique({ where: { id: conv.leadId } })
    : await findLeadByIgUsername(conv.companyId, conv.participantUsername);
  if (lead && !conv.leadId) {
    await prisma.igConversation
      .updateMany({ where: { id: conv.id, leadId: null }, data: { leadId: lead.id } })
      .catch(() => {});
  }
  const prospectBlock = lead
    ? `\n\n# ACHADOS DA EQUIPE SOBRE ESTE PROSPECT — é ESTE o material do "diagnóstico" que a abordagem prometeu.\n` +
      `Use como CONTEÚDO da conversa: quando o contato aceitar ver / pedir pra mostrar, entregue 2-3 achados concretos daqui, com as suas palavras, um por bolha. NÃO copie a ficha inteira, não leia como lista e nunca diga que existe uma ficha.\n` +
      [
        lead.name ? `- Nome/negócio: ${lead.name}` : null,
        lead.segment ? `- Segmento: ${lead.segment}` : null,
        lead.city ? `- Cidade: ${lead.city}` : null,
        lead.notes ? `- Avaliação da equipe:\n${lead.notes.slice(0, 1500)}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const catalog = await getServicesCatalogBlock(conv.companyId);
  const checklist = assistant.qualificationChecklist?.trim()
    ? `\n\n# CHECKLIST DE QUALIFICAÇÃO (colete naturalmente, UMA informação por vez)\n${assistant.qualificationChecklist.trim()}`
    : "";
  const learnings = assistant.learnings?.trim()
    ? `\n\n# APRENDIZADOS (correções do gestor — respeite sempre)\n${assistant.learnings.trim()}`
    : "";
  const scheduling = assistant.schedulingLink?.trim()
    ? `\n\nLink de agendamento (copie EXATAMENTE quando for convidar para reunião): ${assistant.schedulingLink.trim()}`
    : "";

  // Continuidade: a abordagem (enviada pela equipe) costuma terminar com uma
  // oferta — "posso te mostrar o que vi?". Quando o contato aceita, o pecado é
  // responder com pergunta genérica de dor em vez de ENTREGAR o prometido.
  const lastTeamMsg = [...history].reverse().find((m) => m.direction === "OUT");
  const contactAccepted = looksLikeAcceptance(lastIn.text ?? "");
  const teamOffered = /\?|posso|quer que|te mostro|te mando|mostrar|vi (?:que|uma|algo)/i.test(lastTeamMsg?.text ?? "");
  const continuityBlock =
    contactAccepted && teamOffered
      ? `\n# ⚠️ O CONTATO ACABOU DE ACEITAR (prioridade máxima)\nA última mensagem nossa fez uma oferta/pergunta e o contato respondeu que SIM. Siga o FLUXO abaixo a partir do passo que faz sentido — e NÃO pergunte "qual sua maior dificuldade" nem qualquer pergunta genérica de qualificação agora: quem acabou de dizer "pode mostrar" quer ver, não responder questionário.`
      : "";

  // Anti-alucinação: o modelo não abre perfil nenhum. Ele já afirmou "sua bio
  // está sem chamada pra ação" para um perfil que TINHA — o contato percebe na
  // hora e a conversa morre. Só pode afirmar o que está nos achados da equipe.
  // Quantas vezes o agente já puxou agendamento nesta conversa. Passou de 2,
  // vira insistência — e insistência queima a reputação de quem prospecta.
  const inviteRe = /\b(agendar|agendamos|marcar|marcamos|15\s?min|quinze minutos|hor[áa]rio|conversa r[áa]pida|bate-?papo)\b/i;
  const invitesSent = history.filter(
    (m) => m.direction === "OUT" && m.source === "AI" && inviteRe.test(m.text ?? ""),
  ).length;
  const inviteGuard =
    invitesSent >= 2
      ? `\n# ⛔ PARE DE CONVIDAR (você já chamou pra conversa ${invitesSent} vezes)
Não convide de novo, não pergunte "vamos agendar?", não reformule o convite. A pessoa já entendeu e não engatou.
Responda o que ela perguntou, seja útil de graça e ENCERRE com simpatia — ou passe pro humano com action "HANDOFF". Insistir daqui pra frente só queima a imagem do Diego.`
      : "";

  const notLeadBlock = `\n# 🚩 QUANDO NÃO É LEAD (pare de vender na hora)
Estes casos NÃO são clientes em potencial. NÃO convide pra conversa, NÃO insista, NÃO tente qualificar. Responda UMA frase educada e use action "HANDOFF":
- Proposta de EMPREGO ou vaga (CLT, freelancer fixo, salário, "ofereço R$X + benefícios"), ou alguém querendo contratar o Diego como funcionário.
- Parceria, permuta, convite para evento/podcast, pedido de divulgação.
- Alguém vendendo algo PARA nós (serviço, curso, ferramenta).
- Assunto pessoal, cobrança ou qualquer coisa fora de prospecção.
Exemplo: "Essa parte quem vê é o Diego mesmo — já passei pra ele te responder por aqui 👍"
Sinal claro de erro: se a pessoa está te oferecendo dinheiro/trabalho e você respondeu convidando pra agendar, você errou. Ela não é lead.`;

  const groundingBlock = `\n# 🚫 REGRA DE OURO — NUNCA INVENTE UM DIAGNÓSTICO
Você NÃO consegue abrir, ver, acessar ou analisar perfis do Instagram, sites, bio ou ficha do Google. Você não "deu uma olhada" em nada.
- A ÚNICA coisa que você sabe sobre o negócio do contato é o que está em ACHADOS DA EQUIPE${lead ? "" : " — e nesta conversa NÃO HÁ achados nenhum"}.
- É PROIBIDO afirmar qualquer característica do perfil que não esteja lá ("sua bio está sem link", "falta chamada pra ação", "seu feed está desorganizado"). Já aconteceu de dizer que faltava link na bio quando tinha — isso queima a confiança na hora.
- Se o contato pedir análise de um perfil que não está nos achados (por exemplo um segundo perfil dele), seja honesto e simpático: diga que vai olhar com calma e que retorna com os pontos — e use action "HANDOFF" pra equipe assumir. NUNCA chute pra parecer útil.

# 🚫 NUNCA INVENTE CONHECIMENTO OU EXPERIÊNCIA
Você também não sabe de que setores, mercados ou assuntos técnicos o Diego entende — só o que está no manual e no catálogo.
- É PROIBIDO dizer que ele entende do ramo do contato, que já atendeu casos parecidos, ou citar experiência/números/cases que não estejam escritos aqui. JÁ ACONTECEU de afirmar que ele entendia de plantio, tomate e irrigação — ele não entende nada disso, e a pessoa percebe na hora.
- O que o Diego domina é o DIGITAL do negócio (aparecer, atrair cliente, organizar a presença) — nunca a operação técnica do ramo dela.
- Perguntaram "você entende do meu setor?": responda com honestidade e vantagem — "de [setor] quem entende é você; o que a gente domina é fazer teu negócio aparecer e atrair cliente. Na conversa vocês juntam as duas coisas."`;

  const flowBlock = `\n# FLUXO DESTA CONVERSA (Direct de prospecção)
1. FOLLOW — NÃO peça follow por conta própria: o sistema cuida disso sozinho (checa de verdade se a pessoa segue e manda o pedido oficial com botão). Se você está sendo chamado, é porque esse passo já foi resolvido — vá direto pro passo 2.
2. ENTREGA — com o follow feito (ou já existente), entregue o diagnóstico: 2-3 achados concretos dos ACHADOS DA EQUIPE, com as suas palavras, um por bolha, simples e direto. Sem enrolação e sem prometer pra depois.
3. CONVITE — logo depois de entregar, puxe para a sessão gratuita de diagnóstico${assistant.schedulingLink?.trim() ? " (mande o link de agendamento)" : ""}, conectando com o que você acabou de mostrar.
Nunca pule o passo 2: pedir follow e depois não entregar nada é o pior cenário.`;

  // @ enviado pelo contato (link ou menção) — o modelo pedia o @ que já tinha
  // sido informado, ou tratava o link como pedido de follow.
  const handlesFromContact = extractIgHandles(lastIn.text ?? "");
  const handleBlock = handlesFromContact.length
    ? `\n# PERFIL INFORMADO PELO CONTATO\nO contato enviou: ${handlesFromContact.map((h) => "@" + h).join(", ")}. É sobre esse perfil que ele quer falar — NÃO peça de novo o @ nem o link (você já tem), e não interprete como pedido para ele te seguir. Fale sobre esse perfil.`
    : "";

  const system = [
    `Você atende o DIRECT DO INSTAGRAM de uma empresa. Estilo: mensagens curtas de chat (1 a 3 bolhas de no máximo ~2 frases), tom humano e natural, no idioma do contato.`,
    continuityBlock,
    notLeadBlock,
    inviteGuard,
    groundingBlock,
    flowBlock,
    handleBlock,
    assistant.discloseAi
      ? "Você PODE se apresentar como assistente de IA, com leveza."
      : "Não afirme nem negue ser uma IA; simplesmente atenda bem.",
    `\n# MANUAL DA EMPRESA (sua diretriz principal)\n${assistant.manual}`,
    learnings,
    checklist,
    prospectBlock,
    catalog,
    scheduling,
    `\n# CONTEXTO\n- Contato: ${conv.participantUsername ? "@" + conv.participantUsername : "sem @ identificado"}.\n- ${followLine}\n- Mensagens do histórico marcadas [equipe] foram enviadas manualmente por um humano do time — use-as como contexto do que já foi dito. "[equipe]" é uma ETIQUETA INTERNA: JAMAIS escreva "[equipe]" (ou qualquer marcador entre colchetes) nas suas mensagens.\n- Você está no meio de uma conversa que a equipe começou: continue de onde ela parou. Nunca reinicie do zero, nunca reapresente a empresa e nunca peça algo que o contato já respondeu.`,

    `\n# O QUE NÃO FAZER (erros que já aconteceram aqui)
- Frase de enchimento sem informação ("isso pode ajudar a otimizar seu negócio", "que bom que você está aqui"). Toda bolha precisa dizer algo concreto ou fazer a conversa avançar; se não tem o que dizer, mande menos bolhas.
- Perguntar "qual sua maior dificuldade" logo depois que o contato aceitou ver algo — primeiro entregue, depois pergunte.
- Pedir dado que já está no histórico (@ do perfil, nome do negócio, link).
- Tratar um link/perfil enviado pelo contato como pedido de follow.
- Prometer análise para depois sem entregar nada agora: entregue pelo menos um ponto concreto na hora.`,
    `\n# FORMATO DA RESPOSTA\nResponda SOMENTE com um JSON válido, sem texto fora dele:\n{"reply": ["bolha 1", "bolha 2 (opcional)"], "action": "NONE"}\n- "reply": 1 a 3 bolhas CURTAS; resposta simples = 1 bolha; UMA pergunta no máximo, na última bolha; no máximo 1 emoji no total.\n- "action": "NONE" para continuar conversando; "HANDOFF" quando o contato pedir atendimento humano ou você não souber ajudar (nesse caso "reply" avisa que alguém do time vai assumir).\n- Se não houver nada útil a dizer, responda {"reply": [], "action": "NONE"}.`,
  ]
    .filter(Boolean)
    .join("\n");

  const chat: ChatMessage[] = [{ role: "system", content: system }];
  for (const m of history) {
    if (!m.text?.trim()) continue;
    if (m.direction === "IN") chat.push({ role: "user", content: m.text });
    else {
      const prefix = m.source === "EXTERNAL" || m.source === "AGENT" ? "[equipe] " : "";
      chat.push({ role: "assistant", content: prefix + m.text });
    }
  }

  const result = await runAssistant({
    companyId: conv.companyId,
    endpoint: "ig-auto-agent",
    messages: chat,
    assistantId: assistant.id,
    model: assistant.model,
    temperature: assistant.temperature,
    maxTokens: MAX_REPLY_TOKENS,
  });
  if (!result.ok) return skip(`ia_${result.code}`, { error: result.error });

  const decision = parseDecision(result.text) ?? { reply: [result.text.trim()].filter(Boolean).slice(0, 1), action: "NONE" as const };

  // Reconfere que ninguém respondeu enquanto a IA pensava.
  const fresh = await prisma.igConversation.findUnique({
    where: { id: conv.id },
    select: { lastDirection: true, aiMode: true },
  });
  if (!fresh || fresh.lastDirection !== "IN" || fresh.aiMode !== "ACTIVE") return skip("respondida_durante_ia");

  for (const bubble of decision.reply) {
    try {
      const mid = await sendMessageToUser(conv.participantId, bubble, token);
      await recordIgMessage({
        companyId: conv.companyId,
        channel: "INSTAGRAM",
        connectionId: conv.connectionId ?? conv.accountId ?? conv.participantId,
        accountId: conv.accountId,
        participantId: conv.participantId,
        direction: "OUT",
        source: "AI",
        text: bubble,
        mid,
      });
    } catch (e: any) {
      console.error(`[IgAgent] envio falhou conv=${conv.id}:`, e?.message);
      recordRun({ conv: conv.id, error: `envio: ${e?.message?.slice(0, 200)}` });
      return;
    }
    if (decision.reply.length > 1) await new Promise((r) => setTimeout(r, BUBBLE_DELAY_MS));
  }

  if (decision.action === "HANDOFF") {
    await prisma.igConversation.update({
      where: { id: conv.id },
      data: { aiMode: "PAUSED_HUMAN", needsReply: true },
    });
  }

  recordRun({ conv: conv.id, action: decision.action, bubbles: decision.reply.length, follows });
  console.log(`[IgAgent] conv=${conv.id} action=${decision.action} bolhas=${decision.reply.length}`);
}
