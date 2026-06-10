import { prisma } from "./prisma";
import { getOpenAIConfig, chatCompletionDetailed } from "./openai";
import type { AssistantType } from "@/generated/prisma";

/**
 * Motor dos Assistentes de IA.
 *
 * Arquitetura de consumo (decidida com Diego):
 * - A API Key da OpenAI é GLOBAL (do sistema), não por empresa.
 * - O controle de consumo é por empresa, em "interações": 1 chamada = 1 interação.
 * - Cota MENSAL que reseta (Company.aiMonthlyQuota / aiUsedThisMonth / aiQuotaResetAt).
 * - Cada chamada grava um AiUsageLog com os tokens reais (custo) pra relatório.
 *
 * Use `runAssistant()` em qualquer fluxo de IA cobrável. Ele cuida de:
 *   1. resetar a cota se o período virou;
 *   2. bloquear se a cota acabou (ou nunca foi liberada);
 *   3. chamar a OpenAI com a key global;
 *   4. registrar o consumo (log + incremento do contador).
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type RunAssistantResult =
  | { ok: true; text: string; remaining: number }
  | { ok: false; code: "QUOTA" | "NO_CONFIG" | "AI_ERROR"; error: string };

export interface AiUsageSummary {
  quota: number;
  used: number;
  remaining: number;
  resetAt: Date | null;
}

/** Primeiro dia do próximo mês às 00:00 (local do servidor, BRT). */
function firstOfNextMonth(from: Date): Date {
  return new Date(from.getFullYear(), from.getMonth() + 1, 1, 0, 0, 0, 0);
}

/**
 * Lê o estado de cota da empresa, aplicando o reset mensal se o período virou.
 * Persiste o reset quando necessário (used → 0, resetAt → próximo mês).
 */
export async function getAiUsage(companyId: string): Promise<AiUsageSummary> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { aiMonthlyQuota: true, aiUsedThisMonth: true, aiQuotaResetAt: true },
  });
  if (!company) return { quota: 0, used: 0, remaining: 0, resetAt: null };

  const now = new Date();
  let { aiUsedThisMonth: used, aiQuotaResetAt: resetAt } = company;
  const quota = company.aiMonthlyQuota;

  // Período virou (ou nunca foi inicializado) → zera o contador.
  if (!resetAt || now >= resetAt) {
    used = 0;
    resetAt = firstOfNextMonth(now);
    await prisma.company.update({
      where: { id: companyId },
      data: { aiUsedThisMonth: 0, aiQuotaResetAt: resetAt },
    });
  }

  return {
    quota,
    used,
    remaining: Math.max(0, quota - used),
    resetAt,
  };
}

/**
 * Retorna o agente ATIVO de um tipo para a empresa. Se `instanceId` for passado,
 * prioriza um agente vinculado àquela instância; senão pega o agente sem vínculo
 * (genérico do tipo). Retorna null se não houver agente configurado.
 */
export async function getActiveAssistant(
  companyId: string,
  type: AssistantType,
  instanceId?: string | null,
) {
  // 1) agente específico da instância
  if (instanceId) {
    const byInstance = await prisma.assistant.findFirst({
      where: { companyId, type, isActive: true, instanceId },
      orderBy: { updatedAt: "desc" },
    });
    if (byInstance) return byInstance;
  }
  // 2) agente genérico do tipo (sem instância) — fallback
  return prisma.assistant.findFirst({
    where: { companyId, type, isActive: true, instanceId: null },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Roteamento por instância: retorna o agente ATIVO vinculado a uma instância
 * WhatsApp, INDEPENDENTE do tipo. É o que permite que o número do financeiro use
 * o agente FINANCEIRO, o de vendas use o VENDAS, etc. Retorna null se nenhum
 * agente está vinculado àquela instância.
 */
export async function getAssistantForInstance(companyId: string, instanceId: string | null) {
  if (!instanceId) return null;
  return prisma.assistant.findFirst({
    where: { companyId, instanceId, isActive: true },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Monta o bloco "CATÁLOGO DE SERVIÇOS" pra injetar no prompt do agente.
 * Inclui nome, descrição, perguntas de qualificação, argumentos e referências.
 * NÃO inclui priceRange (uso interno — o SDR nunca informa preço).
 * Retorna "" se a empresa não tem serviços ativos.
 */
export async function getServicesCatalogBlock(companyId: string): Promise<string> {
  const services = await prisma.service.findMany({
    where: { companyId, isActive: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: {
      name: true,
      description: true,
      qualifyingQuestions: true,
      salesArguments: true,
      references: true,
    },
  });
  if (!services.length) return "";

  const parts = services.map((s, i) => {
    const lines: string[] = [`## ${i + 1}. ${s.name}`];
    if (s.description?.trim()) lines.push(s.description.trim());
    if (s.qualifyingQuestions?.trim()) lines.push(`Perguntas de qualificação:\n${s.qualifyingQuestions.trim()}`);
    if (s.salesArguments?.trim()) lines.push(`Argumentos:\n${s.salesArguments.trim()}`);
    if (s.references?.trim()) lines.push(`Referências:\n${s.references.trim()}`);
    return lines.join("\n");
  });

  return `\n\n# CATÁLOGO DE SERVIÇOS (consulte para reconhecer o que o contato quer e qualificar; faça UMA pergunta por vez; nunca informe preço)\n${parts.join("\n\n")}`;
}

/**
 * Executa uma interação de IA cobrável. Verifica/consome cota, chama a OpenAI
 * com a key global, e registra o consumo. Retorna texto ou um erro tipado.
 */
export async function runAssistant(params: {
  companyId: string;
  endpoint: string;            // "suggest-reply" | "summarize" | ...
  messages: ChatMessage[];
  assistantId?: string | null;
  userId?: string | null;
  model?: string | null;
  temperature?: number | null;
  maxTokens?: number;
}): Promise<RunAssistantResult> {
  const { companyId, endpoint, messages, assistantId, userId } = params;

  // 1) Cota
  const usage = await getAiUsage(companyId);
  if (usage.quota <= 0) {
    return {
      ok: false,
      code: "QUOTA",
      error: "Os créditos de IA desta empresa não estão liberados. Configure a cota mensal.",
    };
  }
  if (usage.remaining <= 0) {
    return {
      ok: false,
      code: "QUOTA",
      error: "Cota mensal de IA esgotada. Aguarde a renovação ou aumente o limite.",
    };
  }

  // 2) Config global da OpenAI
  const config = await getOpenAIConfig();
  if (!config) {
    return {
      ok: false,
      code: "NO_CONFIG",
      error: "OpenAI não configurada no sistema (Configurações → Integrações → OpenAI).",
    };
  }

  // 3) Chamada
  const result = await chatCompletionDetailed(config, messages, {
    maxTokens: params.maxTokens,
    temperature: params.temperature ?? undefined,
    model: params.model ?? undefined,
  });

  if (!result.text) {
    return { ok: false, code: "AI_ERROR", error: "A IA não retornou resposta. Tente novamente." };
  }

  // 4) Registra consumo: 1 interação + tokens reais. Incrementa o contador.
  //    (log e incremento juntos; se o log falhar, ainda assim cobramos a interação.)
  await prisma.$transaction([
    prisma.aiUsageLog.create({
      data: {
        companyId,
        assistantId: assistantId ?? null,
        endpoint,
        model: result.model,
        tokensPrompt: result.usage?.prompt ?? 0,
        tokensCompletion: result.usage?.completion ?? 0,
        tokensTotal: result.usage?.total ?? 0,
        userId: userId ?? null,
      },
    }),
    prisma.company.update({
      where: { id: companyId },
      data: { aiUsedThisMonth: { increment: 1 } },
    }),
  ]);

  return { ok: true, text: result.text, remaining: usage.remaining - 1 };
}
