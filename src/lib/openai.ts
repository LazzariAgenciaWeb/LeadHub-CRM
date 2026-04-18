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

/**
 * Faz uma chamada ao endpoint /chat/completions da OpenAI.
 * Retorna o texto gerado ou null em caso de erro.
 */
export async function chatCompletion(
  config: OpenAIConfig,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: { maxTokens?: number; temperature?: number }
): Promise<string | null> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model:       config.model,
        messages,
        max_tokens:  options?.maxTokens  ?? 512,
        temperature: options?.temperature ?? 0.7,
      }),
    });

    if (!res.ok) {
      console.error("[OpenAI] chatCompletion error:", res.status, await res.text());
      return null;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    console.error("[OpenAI] chatCompletion exception:", err);
    return null;
  }
}
