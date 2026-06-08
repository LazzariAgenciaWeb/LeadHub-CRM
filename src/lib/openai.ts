import { prisma } from "./prisma";

export interface OpenAIConfig {
  apiKey: string;
  model: string;
}

/**
 * Carrega as configurações da OpenAI do banco de dados.
 * Retorna null se a chave não estiver configurada.
 */
export async function getOpenAIConfig(): Promise<OpenAIConfig | null> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ["openai_api_key", "openai_model"] } },
  });

  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  if (!map.openai_api_key?.trim()) return null;

  return {
    apiKey: map.openai_api_key.trim(),
    model:  map.openai_model?.trim() || "gpt-4o-mini",
  };
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface ChatResult {
  text: string | null;
  usage: TokenUsage | null;
  model: string;
}

/**
 * Versão detalhada: retorna texto + uso de tokens (response.usage) + modelo.
 * Usada pelo controle de consumo (AiUsageLog / cota por empresa).
 */
export async function chatCompletionDetailed(
  config: OpenAIConfig,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: { maxTokens?: number; temperature?: number; model?: string }
): Promise<ChatResult> {
  const model = options?.model?.trim() || config.model;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens:  options?.maxTokens  ?? 512,
        temperature: options?.temperature ?? 0.7,
      }),
    });

    if (!res.ok) {
      console.error("[OpenAI] chatCompletion error:", res.status, await res.text());
      return { text: null, usage: null, model };
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() ?? null;
    const u = data.usage;
    const usage: TokenUsage | null = u
      ? {
          prompt: u.prompt_tokens ?? 0,
          completion: u.completion_tokens ?? 0,
          total: u.total_tokens ?? 0,
        }
      : null;
    return { text, usage, model };
  } catch (err) {
    console.error("[OpenAI] chatCompletion exception:", err);
    return { text: null, usage: null, model };
  }
}

/**
 * Faz uma chamada ao endpoint /chat/completions da OpenAI.
 * Retorna o texto gerado ou null em caso de erro.
 *
 * NOTA: este wrapper NÃO controla cota nem registra consumo. Para fluxos de
 * Assistente com cobrança por interação, use `runAssistant()` em lib/assistant.ts.
 */
export async function chatCompletion(
  config: OpenAIConfig,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: { maxTokens?: number; temperature?: number }
): Promise<string | null> {
  const { text } = await chatCompletionDetailed(config, messages, options);
  return text;
}
