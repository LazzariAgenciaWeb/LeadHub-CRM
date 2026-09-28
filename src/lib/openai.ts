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
 * Transcreve um áudio (base64) via Whisper. Usado pelo assistente pessoal
 * (áudio no WhatsApp ou microfone no app). Retorna null em erro.
 */
export async function transcribeAudio(
  config: OpenAIConfig,
  base64: string,
  mimeType: string | null,
  options?: { language?: string; prompt?: string }
): Promise<string | null> {
  try {
    const mime = (mimeType ?? "audio/ogg").split(";")[0].trim();
    const ext =
      mime.includes("ogg") ? "ogg" :
      mime.includes("mpeg") || mime.includes("mp3") ? "mp3" :
      mime.includes("mp4") || mime.includes("m4a") ? "m4a" :
      mime.includes("webm") ? "webm" :
      mime.includes("wav") ? "wav" : "ogg";

    const bytes = Buffer.from(base64, "base64");
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), `audio.${ext}`);
    form.append("model", "whisper-1");
    form.append("language", options?.language ?? "pt");
    if (options?.prompt) form.append("prompt", options.prompt);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      console.error("[OpenAI] transcribeAudio error:", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    return text || null;
  } catch (err) {
    console.error("[OpenAI] transcribeAudio exception:", err);
    return null;
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
