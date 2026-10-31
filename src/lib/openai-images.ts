import { getOpenAIConfig, type OpenAIConfig } from "./openai";
import type { Ratio } from "./image-gen";

// Geração de imagem pela OpenAI (gpt-image). Usa a MESMA chave que o resto da
// IA do sistema (`openai_api_key`) — não tem chave separada.
//
// Atenção: assinatura do ChatGPT (Plus/Pro) NÃO dá acesso à API. A API é
// pré-paga em platform.openai.com, cobrada à parte.
//
// Diferente do Freepik, aqui é tudo síncrono: o POST já devolve a imagem em
// base64 (`data[].b64_json`).

export { getOpenAIConfig };
export type { OpenAIConfig };

export const OPENAI_IMAGE_MODELS = [
  {
    id: "gpt-image-2.5-sunburst",
    label: "GPT Image 2.5 Sunburst (OpenAI)",
    desc: "Segue a descrição ao pé da letra e escreve texto na imagem. Usa a chave da OpenAI.",
  },
  {
    id: "gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare (OpenAI)",
    desc: "Irmão do Sunburst, mesmo preço — gera diferente. Vale comparar os dois.",
  },
] as const;

// A OpenAI aceita tamanho livre (múltiplo de 16, dentro de um limite de
// pixels), então dá pra entregar a proporção exata. Se ela recusar o tamanho,
// cai no tamanho "recomendado" mais próximo (FALLBACK) e gera de todo jeito.
const SIZE: Record<Ratio, string> = {
  "1:1":  "1024x1024",
  "4:5":  "1024x1280",
  "3:4":  "960x1280",
  "9:16": "864x1536",
  "16:9": "1536x864",
};

const FALLBACK: Record<Ratio, string> = {
  "1:1":  "1024x1024",
  "4:5":  "1024x1536",
  "3:4":  "1024x1536",
  "9:16": "1024x1536",
  "16:9": "1536x1024",
};

export type OpenAIImageResult =
  | { images: string[]; size: string }
  | { error: string; status: number };

async function call(
  config: OpenAIConfig,
  model: string,
  prompt: string,
  size: string,
  numImages: number,
): Promise<{ ok: true; images: string[] } | { ok: false; status: number; message: string }> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model, prompt, size, n: numImages, output_format: "png" }),
    cache: "no-store",
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let message = raw.slice(0, 300);
    try {
      const body = JSON.parse(raw);
      if (typeof body?.error?.message === "string") message = body.error.message;
    } catch { /* não era JSON */ }
    return { ok: false, status: res.status, message };
  }

  const data = await res.json().catch(() => null);
  const images = Array.isArray(data?.data)
    ? data.data.map((d: any) => d?.b64_json).filter((b: unknown): b is string => typeof b === "string" && !!b)
    : [];
  return { ok: true, images };
}

export async function generateOpenAIImage(
  config: OpenAIConfig,
  model: string,
  input: { prompt: string; ratio: Ratio; numImages: number },
): Promise<OpenAIImageResult> {
  const wanted = SIZE[input.ratio];
  try {
    let out = await call(config, model, input.prompt, wanted, input.numImages);
    let size = wanted;

    // Tamanho exato recusado: tenta o recomendado (1:1, retrato 2:3 ou
    // paisagem 3:2). A proporção sai aproximada, mas a imagem sai.
    if (!out.ok && out.status === 400 && /size|dimension|width|height/i.test(out.message) && FALLBACK[input.ratio] !== wanted) {
      size = FALLBACK[input.ratio];
      out = await call(config, model, input.prompt, size, input.numImages);
    }

    if (!out.ok) {
      console.error("[OpenAI images]", out.status, out.message);
      return {
        error: out.message || `Erro ${out.status} na API da OpenAI`,
        status: out.status === 401 || out.status === 429 ? out.status : 502,
      };
    }
    if (!out.images.length) return { error: "A OpenAI não devolveu imagem", status: 502 };
    return { images: out.images, size };
  } catch (err) {
    console.error("[OpenAI images] exception:", err);
    return { error: "Não foi possível falar com a API da OpenAI", status: 502 };
  }
}
