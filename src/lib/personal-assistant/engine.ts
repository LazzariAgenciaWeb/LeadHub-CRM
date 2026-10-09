import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getAnthropicConfig, anthropicClient } from "@/lib/anthropic";
import { getOpenAIConfig } from "@/lib/openai";
import { getAiUsage } from "@/lib/assistant";
import { ALL_TOOLS, anthropicToolDefs, getTool, type ToolChannel, type ToolContext, type ToolResult } from "@/lib/assistant-tools/registry";

/**
 * Engine do assistente pessoal — o mesmo motor atrás das três portas (chat do
 * app, grupo do WhatsApp e MCP). Loop manual de tool use com o Claude:
 *
 *   texto do usuário → modelo escolhe ferramentas → executa (ou guarda pra
 *   confirmação) → devolve resultado ao modelo → resposta final em texto.
 *
 * O contexto (userId/companyId) vem SEMPRE da sessão/token — o modelo nunca
 * escolhe em nome de quem age.
 */

export interface ExecutedAction {
  tool: string;
  ok: boolean;
  message: string;
  link?: string;
  data?: unknown;
}

export interface AssistantRunResult {
  ok: boolean;
  reply: string;
  actions: ExecutedAction[];
  pending?: { id: string; summary: string } | null;
  error?: string;
}

const HISTORY_TURNS = 20;
const HISTORY_HOURS = 24;
const PENDING_TTL_MIN = 30;
const MAX_ITERATIONS = 8;

const CONFIRM_TOOL = "confirmar_acao_pendente";
const CANCEL_TOOL = "cancelar_acao_pendente";

export async function getToolContext(userId: string, channel: ToolChannel): Promise<ToolContext | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, companyId: true } });
  if (!user?.companyId) return null;
  return {
    userId: user.id,
    userName: user.name,
    companyId: user.companyId,
    role: user.role,
    isAdmin: user.role === "ADMIN" || user.role === "SUPER_ADMIN",
    channel,
    now: new Date(),
  };
}

function nowInTz(): { iso: string; human: string; weekday: string } {
  const tz = process.env.SYSTEM_TIMEZONE || "America/Sao_Paulo";
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "longOffset" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const off = get("timeZoneName").replace("GMT", "") || "-03:00";
  const iso = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${off.length === 3 ? `${off}:00` : off}`;
  const human = d.toLocaleString("pt-BR", { timeZone: tz, dateStyle: "full", timeStyle: "short" });
  const weekday = d.toLocaleDateString("pt-BR", { timeZone: tz, weekday: "long" });
  return { iso, human, weekday };
}

function buildSystemPrompt(ctx: ToolContext, companyName: string, pending: { summary: string } | null): string {
  const t = nowInTz();
  const channelHints: Record<ToolChannel, string> = {
    WHATSAPP: "Canal: WhatsApp. Formatação do WhatsApp: *negrito* com asteriscos simples, sem markdown (#, **, tabelas). Mensagens curtas. Emojis com moderação.",
    APP: "Canal: chat no app. Pode usar markdown leve (listas, **negrito**).",
    MCP: "Canal: Claude via MCP. Responda de forma factual e estruturada; o Claude vai reformatar pro usuário.",
  };
  return [
    `Você é o assistente pessoal de ${ctx.userName} dentro do GoHub, o sistema de gestão da empresa "${companyName}". Você é o bloquinho de anotações dele, a memória dele e as mãos dele no sistema.`,
    ``,
    `Agora: ${t.human} (${t.weekday}). ISO com fuso: ${t.iso}. Use SEMPRE este fuso (-03:00) ao montar datas para as ferramentas. "Amanhã", "sexta", "às 15h" são relativos a agora.`,
    ``,
    `Como agir:`,
    `- Quando o usuário pedir algo que uma ferramenta faz, FAÇA (chame a ferramenta) em vez de perguntar. Só pergunte quando faltar algo essencial e não houver default sensato (ex.: qual cliente, entre dois com nome parecido).`,
    `- Antes de criar chamado/projeto/cobrança para um cliente, use buscar_cliente. Se não existir e o usuário deu o nome, crie (clientCompanyName).`,
    `- Datas: se o usuário não disser hora, use 09:00 para lembretes e fim do próximo dia útil (18:00) para prazos de chamado.`,
    `- "Anota", "ideia", "lembrar que" sem data → anotar. "Me lembra às/em" → criar_lembrete. "Tenho que / preciso fazer" → criar_tarefa_pessoal (ou criar_chamado se for demanda da equipe/cliente; criar_tarefa_projeto se citar um projeto).`,
    `- Não duplique assunto: as ferramentas de criar já acrescentam ao item existente quando o assunto é o mesmo (a resposta diz "Acrescentado"). Se o usuário trouxer mais contexto sobre algo já anotado, use acrescentar_ao_item (ache o id com listar_anotacoes). Só use forcarNovo quando ele pedir explicitamente um item separado.`,
    `- "Feito", "concluí", "já resolvi" sobre um item do bloquinho → concluir_item; se o usuário contar COMO resolveu, passe em resultado. "Reabre" → reabrir_item.`,
    `- Itens do bloquinho aceitam etiquetas (tags) curtas: pessoal, financeiro, cliente, marketing, equipe, ideia… Aplique 1 a 3 pelo contexto sem perguntar; o usuário pode pedir "etiqueta X" ou "marca como financeiro".`,
    `- Depois de executar, confirme em UMA linha o que foi criado, com o link quando houver. Não repita o id.`,
    `- Perguntas sobre "o que tenho hoje", "resumo", "estou esquecendo algo" → fila_do_dia e responda priorizando: atrasados primeiro, depois hoje.`,
    `- Ações financeiras exigem confirmação: a ferramenta devolve PENDENTE_CONFIRMACAO. Aí resuma a ação e peça "confirma?". Quando o usuário confirmar ("sim", "confirma", "pode"), chame ${CONFIRM_TOOL}; se recusar, ${CANCEL_TOOL}.`,
    `- Nunca invente dados. Se a ferramenta falhar, diga o erro em linguagem simples.`,
    `- Responda em português do Brasil, direto, sem preâmbulo ("Claro!", "Com certeza!").`,
    ``,
    channelHints[ctx.channel],
    pending ? `\nAÇÃO PENDENTE DE CONFIRMAÇÃO: ${pending.summary}. Se o usuário confirmar, chame ${CONFIRM_TOOL}. Se disser outra coisa não relacionada, cancele com ${CANCEL_TOOL} e siga o novo pedido.` : "",
  ].join("\n");
}

async function loadHistory(userId: string, channel: ToolChannel): Promise<Anthropic.MessageParam[]> {
  const since = new Date(Date.now() - HISTORY_HOURS * 3600_000);
  const rows = await prisma.assistantTurn.findMany({
    where: { userId, channel, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_TURNS,
    select: { role: true, content: true },
  });
  const ordered = rows.reverse();
  // A API exige começar com user e alternar; consolida turnos repetidos.
  const out: Anthropic.MessageParam[] = [];
  for (const r of ordered) {
    const role = r.role === "assistant" ? "assistant" : "user";
    if (out.length === 0 && role === "assistant") continue;
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n${r.content}`;
    } else {
      out.push({ role, content: r.content });
    }
  }
  if (out.length && out[out.length - 1].role === "user") {
    // Último turno sem resposta (erro anterior): descarta pra não confundir.
    out.pop();
  }
  return out;
}

async function loadPending(userId: string) {
  const p = await prisma.assistantPendingAction.findFirst({
    where: { userId, status: "PENDING", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  return p;
}

function extraToolDefs(): Anthropic.Tool[] {
  return [
    { name: CONFIRM_TOOL, description: "Executa a ação pendente de confirmação depois que o usuário confirmou explicitamente.", input_schema: { type: "object", properties: {} } },
    { name: CANCEL_TOOL, description: "Cancela a ação pendente de confirmação.", input_schema: { type: "object", properties: {} } },
  ];
}

export async function runPersonalAssistant(params: {
  userId: string;
  channel: ToolChannel;
  text: string;
  /** Não grava o turno do usuário (ex.: MCP chamando ferramenta direto). */
  skipHistory?: boolean;
}): Promise<AssistantRunResult> {
  const { userId, channel } = params;
  const text = params.text.trim();
  if (!text) return { ok: false, reply: "", actions: [], error: "Mensagem vazia." };

  const ctx = await getToolContext(userId, channel);
  if (!ctx) return { ok: false, reply: "", actions: [], error: "Usuário sem empresa vinculada." };

  const usage = await getAiUsage(ctx.companyId);
  if (usage.quota <= 0 || usage.remaining <= 0) {
    return { ok: false, reply: "", actions: [], error: "Cota mensal de IA esgotada ou não liberada para a empresa." };
  }
  // Motor: Claude (Anthropic) ou OpenAI — escolhido em Configurações → IA.
  // Mesmas ferramentas, mesmo prompt; só muda o formato da chamada.
  const provider = await getAssistantProvider();
  const anthropic = provider.name === "anthropic" ? await getAnthropicConfig() : null;
  const openai = provider.name === "openai" ? await getOpenAIConfig() : null;
  if (provider.name === "anthropic" && !anthropic) {
    return { ok: false, reply: "", actions: [], error: "Chave da Anthropic (Claude) não configurada. Configurações → Integrações → IA." };
  }
  if (provider.name === "openai" && !openai) {
    return { ok: false, reply: "", actions: [], error: "Chave da OpenAI não configurada. Configurações → Integrações → IA." };
  }
  const modelUsed = provider.name === "openai" ? provider.model || openai!.model : anthropic!.model;

  const company = await prisma.company.findUnique({ where: { id: ctx.companyId }, select: { name: true } });
  const pending = await loadPending(userId);
  const system = buildSystemPrompt(ctx, company?.name ?? "empresa", pending ? { summary: pending.summary } : null);
  const history = await loadHistory(userId, channel);
  const tools: Anthropic.Tool[] = [...anthropicToolDefs(), ...extraToolDefs()];

  const actions: ExecutedAction[] = [];
  let newPending: { id: string; summary: string } | null = null;
  let finalText = "";
  let tokensIn = 0, tokensOut = 0;

  /** Executa uma ferramenta pedida pelo modelo (qualquer provedor). */
  const executeTool = async (name: string, input: Record<string, unknown>): Promise<{ content: string; isError: boolean }> => {
    let r: ToolResult;
    try {
      if (name === CONFIRM_TOOL) {
        r = await confirmPending(userId, ctx, actions);
      } else if (name === CANCEL_TOOL) {
        r = await cancelPending(userId);
      } else {
        const def = getTool(name);
        if (!def) r = { ok: false, error: `Ferramenta desconhecida: ${name}` };
        else if (def.confirm) {
          // Guarda a intenção; só executa após confirmação explícita.
          await prisma.assistantPendingAction.updateMany({ where: { userId, status: "PENDING" }, data: { status: "CANCELED", resolvedAt: new Date() } });
          const summary = def.summarize ? def.summarize(input) : `${def.name} ${JSON.stringify(input)}`;
          const p = await prisma.assistantPendingAction.create({
            data: { userId, channel, tool: def.name, input: input as any, summary, expiresAt: new Date(Date.now() + PENDING_TTL_MIN * 60_000) },
            select: { id: true },
          });
          newPending = { id: p.id, summary };
          r = { ok: true, message: `PENDENTE_CONFIRMACAO: ${summary}. Pergunte ao usuário se confirma.` };
        } else {
          r = await def.run(input, ctx);
          if (def.mutating) actions.push({ tool: def.name, ok: r.ok, message: r.ok ? r.message : r.error, link: r.ok ? r.link : undefined, data: r.ok ? r.data : undefined });
        }
      }
    } catch (e: any) {
      console.error(`[assistente] tool ${name} falhou:`, e);
      r = { ok: false, error: e?.message ?? "erro interno" };
    }
    return { content: r.ok ? `${r.message}${r.link ? `\nLink: ${r.link}` : ""}` : `ERRO: ${r.error}`, isError: !r.ok };
  };

  try {
    if (provider.name === "openai") {
      const out = await runOpenAILoop({ apiKey: openai!.apiKey, model: modelUsed, system, history, text, tools, executeTool });
      finalText = out.text; tokensIn = out.tokensIn; tokensOut = out.tokensOut;
    } else {
      const out = await runAnthropicLoop({ config: anthropic!, system, history, text, tools, executeTool });
      finalText = out.text; tokensIn = out.tokensIn; tokensOut = out.tokensOut;
    }
  } catch (e: any) {
    console.error(`[assistente] erro na chamada ${provider.name}:`, e?.status, e?.message);
    return { ok: false, reply: "", actions, error: e?.status === 401 ? `Chave da ${provider.name === "openai" ? "OpenAI" : "Anthropic"} inválida.` : `Erro na IA: ${e?.message ?? "desconhecido"}` };
  }

  // Histórico + consumo (1 interação, tokens reais).
  if (!params.skipHistory) {
    await prisma.assistantTurn.createMany({
      data: [
        { userId, channel, role: "user", content: text },
        { userId, channel, role: "assistant", content: finalText },
      ],
    }).catch(() => {});
  }
  await prisma.$transaction([
    prisma.aiUsageLog.create({ data: { companyId: ctx.companyId, endpoint: `assistente-${channel.toLowerCase()}`, model: modelUsed, tokensPrompt: tokensIn, tokensCompletion: tokensOut, tokensTotal: tokensIn + tokensOut, userId } }),
    prisma.company.update({ where: { id: ctx.companyId }, data: { aiUsedThisMonth: { increment: 1 } } }),
  ]).catch((e) => console.error("[assistente] usage log:", e));

  const pendingNow = newPending ?? (await loadPending(userId).then((p) => (p ? { id: p.id, summary: p.summary } : null)));
  return { ok: true, reply: finalText, actions, pending: pendingNow };
}

// ── Provedor ─────────────────────────────────────────────────────────────────

export type AssistantProvider = { name: "anthropic" | "openai"; model: string | null };
export const ASSISTANT_OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

/** Setting `assistant_provider` (anthropic|openai) + `assistant_openai_model`. */
export async function getAssistantProvider(): Promise<AssistantProvider> {
  const rows = await prisma.setting.findMany({ where: { key: { in: ["assistant_provider", "assistant_openai_model"] } } });
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  const name = map.assistant_provider?.trim() === "openai" ? "openai" : "anthropic";
  return { name, model: name === "openai" ? (map.assistant_openai_model?.trim() || ASSISTANT_OPENAI_DEFAULT_MODEL) : null };
}

type LoopIO = {
  system: string;
  history: Anthropic.MessageParam[];
  text: string;
  tools: Anthropic.Tool[];
  executeTool: (name: string, input: Record<string, unknown>) => Promise<{ content: string; isError: boolean }>;
};
type LoopOut = { text: string; tokensIn: number; tokensOut: number };

async function runAnthropicLoop(p: LoopIO & { config: { apiKey: string; model: string } }): Promise<LoopOut> {
  const client = anthropicClient(p.config);
  const messages: Anthropic.MessageParam[] = [...p.history, { role: "user", content: p.text }];
  let finalText = "", tokensIn = 0, tokensOut = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await client.messages.create({
      model: p.config.model,
      max_tokens: 4096,
      system: [{ type: "text", text: p.system, cache_control: { type: "ephemeral" } }],
      tools: p.tools,
      messages,
    });
    tokensIn += res.usage.input_tokens; tokensOut += res.usage.output_tokens;

    const textParts = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text.trim()).filter(Boolean);
    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    if (res.stop_reason === "refusal") { finalText = "Não consegui processar esse pedido."; break; }
    if (toolUses.length === 0 || res.stop_reason === "end_turn") {
      finalText = textParts.join("\n").trim();
      if (toolUses.length === 0) break;
    }

    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const r = await p.executeTool(tu.name, (tu.input ?? {}) as Record<string, unknown>);
      results.push({ type: "tool_result", tool_use_id: tu.id, content: r.content, is_error: r.isError });
    }
    messages.push({ role: "user", content: results });
    if (res.stop_reason === "end_turn") break;
  }
  if (!finalText) {
    // Estourou iterações no meio de tools: pede o fechamento em texto.
    const res = await client.messages.create({ model: p.config.model, max_tokens: 1024, system: p.system, messages: [...messages, { role: "user", content: "Resuma em uma frase o que foi feito." }] });
    finalText = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim() || "Feito.";
  }
  return { text: finalText, tokensIn, tokensOut };
}

/**
 * Loop equivalente na OpenAI (chat completions + function calling). Sem SDK:
 * o projeto já fala com a OpenAI por fetch (lib/openai.ts).
 */
async function runOpenAILoop(p: LoopIO & { apiKey: string; model: string }): Promise<LoopOut> {
  type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: any[]; tool_call_id?: string };
  const messages: Msg[] = [{ role: "system", content: p.system }];
  for (const h of p.history) messages.push({ role: h.role, content: typeof h.content === "string" ? h.content : "" });
  messages.push({ role: "user", content: p.text });
  const tools = p.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));

  let finalText = "", tokensIn = 0, tokensOut = 0;
  for (let i = 0; i < MAX_ITERATIONS + 1; i++) {
    const last = i === MAX_ITERATIONS;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify({ model: p.model, messages, tools, tool_choice: last ? "none" : "auto", max_tokens: 2048, temperature: 0.3 }),
    });
    if (!res.ok) {
      const body = await res.text();
      const err: any = new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    tokensIn += data.usage?.prompt_tokens ?? 0; tokensOut += data.usage?.completion_tokens ?? 0;
    const msg = data.choices?.[0]?.message ?? {};
    const calls: any[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (calls.length === 0) { finalText = (msg.content ?? "").trim(); break; }

    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });
    for (const c of calls) {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(c.function?.arguments || "{}"); } catch { input = {}; }
      const r = await p.executeTool(c.function?.name ?? "", input);
      messages.push({ role: "tool", tool_call_id: c.id, content: r.content });
    }
  }
  return { text: finalText || "Feito.", tokensIn, tokensOut };
}

/** Executa a ação pendente (chamada pelo modelo via tool, ou pelo botão no app). */
export async function confirmPending(userId: string, ctx: ToolContext, actions?: ExecutedAction[]): Promise<ToolResult> {
  const p = await loadPending(userId);
  if (!p) return { ok: false, error: "Não há ação pendente (ou expirou)." };
  const def = getTool(p.tool);
  if (!def) return { ok: false, error: "Ferramenta da ação pendente não existe mais." };
  const r = await def.run(p.input as any, ctx);
  await prisma.assistantPendingAction.update({ where: { id: p.id }, data: { status: "CONFIRMED", resolvedAt: new Date() } });
  actions?.push({ tool: def.name, ok: r.ok, message: r.ok ? r.message : r.error, link: r.ok ? r.link : undefined, data: r.ok ? r.data : undefined });
  return r;
}

export async function cancelPending(userId: string): Promise<ToolResult> {
  const n = await prisma.assistantPendingAction.updateMany({ where: { userId, status: "PENDING" }, data: { status: "CANCELED", resolvedAt: new Date() } });
  return { ok: true, message: n.count ? "Ação cancelada." : "Não havia ação pendente." };
}

/** Executa uma ferramenta diretamente (MCP). Ferramentas com `confirm` executam sem pendência — o Claude já confirmou com o usuário do lado dele. */
export async function runToolDirect(userId: string, channel: ToolChannel, name: string, input: Record<string, unknown>): Promise<ToolResult> {
  const ctx = await getToolContext(userId, channel);
  if (!ctx) return { ok: false, error: "Usuário sem empresa vinculada." };
  const def = getTool(name);
  if (!def) return { ok: false, error: `Ferramenta desconhecida: ${name}` };
  try {
    return await def.run(input, ctx);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "erro interno" };
  }
}

export { ALL_TOOLS };
