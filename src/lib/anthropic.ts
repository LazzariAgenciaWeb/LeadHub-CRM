import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./prisma";

/**
 * Config global da Anthropic (Claude) — mesma convenção da OpenAI: chaves na
 * tabela Setting (`anthropic_api_key`, `anthropic_model`), editadas pelo
 * SUPER_ADMIN em Configurações → Integrações → IA.
 *
 * Usada pelo assistente pessoal (tool use). O restante da IA (sugestão de
 * resposta, resumos, auto-agent) continua na OpenAI.
 */
export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5";

export interface AnthropicConfig {
  apiKey: string;
  model: string;
}

export async function getAnthropicConfig(): Promise<AnthropicConfig | null> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ["anthropic_api_key", "anthropic_model"] } },
  });
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  const apiKey = map.anthropic_api_key?.trim() || process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;

  return {
    apiKey,
    model: map.anthropic_model?.trim() || ANTHROPIC_DEFAULT_MODEL,
  };
}

export function anthropicClient(config: AnthropicConfig): Anthropic {
  return new Anthropic({ apiKey: config.apiKey });
}
