import {
  getFreepikConfig, MODELS as FREEPIK_MODELS, startGeneration, taskStatus, downloadImage,
} from "./freepik";
import { OPENAI_IMAGE_MODELS, getOpenAIConfig, generateOpenAIImage } from "./openai-images";

// Fachada de geração de imagem por IA: junta os modelos do Freepik e da OpenAI
// num único catálogo, pra quem usa (rota/tela) não precisar saber de qual
// provedor cada modelo é.
//
// Freepik → chave própria (`freepik_api_key`), vários modelos, alguns
//   assíncronos (devolvem task_id e a imagem fica pronta depois).
// OpenAI  → mesma chave do resto da IA (`openai_api_key`), sempre síncrono.
//   Lembrete: assinatura do ChatGPT não serve, a API é cobrada à parte.

export { downloadImage };

// ─────────────────────────── Proporções ───────────────────────────

export const RATIOS = [
  { value: "1:1",  label: "1:1 · Feed quadrado" },
  { value: "4:5",  label: "4:5 · Feed retrato" },
  { value: "9:16", label: "9:16 · Story / Reels" },
  { value: "16:9", label: "16:9 · Horizontal / capa" },
  { value: "3:4",  label: "3:4 · Retrato clássico" },
] as const;

export type Ratio = (typeof RATIOS)[number]["value"];

export function isRatio(v: unknown): v is Ratio {
  return typeof v === "string" && RATIOS.some((r) => r.value === v);
}

// ─────────────────────────── Catálogo ───────────────────────────

export type Provider = "freepik" | "openai";

export interface ImageModelInfo {
  id: string;
  label: string;
  desc: string;
  provider: Provider;
  /** Quantas imagens por chamada (só o clássico do Freepik aceita mais de uma). */
  maxImages: number;
  /** sync = imagem volta no POST; task = precisa consultar depois. */
  mode: "sync" | "task";
}

// Gerar imagem pela OpenAI está DESLIGADO de propósito: a chave da OpenAI é a
// mesma que paga o assistente pessoal, o WhatsApp e a transcrição de áudio, e
// imagem é caro (US$ 30 por 1M de tokens de saída) — o crédito fica reservado
// pra esses usos. O código do provedor continua aqui: pra ligar de novo é só
// trocar pra `true`.
const OPENAI_IMAGES_ENABLED = false;

const CATALOG: ImageModelInfo[] = [
  ...FREEPIK_MODELS.map((m) => ({
    id: m.id, label: m.label, desc: m.desc, provider: "freepik" as const,
    maxImages: m.maxImages, mode: m.mode,
  })),
  ...(OPENAI_IMAGES_ENABLED
    ? OPENAI_IMAGE_MODELS.map((m) => ({
        id: m.id, label: m.label, desc: m.desc, provider: "openai" as const,
        maxImages: 1, mode: "sync" as const,
      }))
    : []),
];

export function listImageModels(): ImageModelInfo[] {
  return CATALOG;
}

export function findImageModel(id: string | undefined | null): ImageModelInfo | null {
  return CATALOG.find((m) => m.id === id) ?? null;
}

/** Quais provedores têm chave salva — a tela desabilita o que não dá pra usar. */
export async function configuredProviders(): Promise<Record<Provider, boolean>> {
  const [freepik, openai] = await Promise.all([
    getFreepikConfig(),
    OPENAI_IMAGES_ENABLED ? getOpenAIConfig() : null,
  ]);
  return { freepik: !!freepik, openai: !!openai };
}

// ─────────────────────────── Geração ───────────────────────────

export interface GenInput {
  prompt: string;
  ratio: Ratio;
  numImages: number;
}

export type GenError = { error: string; status: number };

export type StartImageResult =
  /** Imagens já prontas, em base64 puro (sem prefixo `data:`). */
  | { kind: "images"; images: string[] }
  /** Geração assíncrona: consultar com pollImage() até ficar pronta. */
  | { kind: "task"; taskId: string }
  | GenError;

const NO_FREEPIK: GenError = {
  error: "Freepik não configurado. Configurações → Integrações → Inteligência Artificial.",
  status: 503,
};
const NO_OPENAI: GenError = {
  error: "OpenAI não configurada. Configurações → Integrações → Inteligência Artificial.",
  status: 503,
};

export async function startImage(model: ImageModelInfo, input: GenInput): Promise<StartImageResult> {
  if (model.provider === "openai") {
    if (!OPENAI_IMAGES_ENABLED) return { error: "Geração de imagem pela OpenAI está desligada", status: 400 };
    const config = await getOpenAIConfig();
    if (!config) return NO_OPENAI;
    const out = await generateOpenAIImage(config, model.id, input);
    if ("error" in out) return out;
    return { kind: "images", images: out.images };
  }

  const config = await getFreepikConfig();
  if (!config) return NO_FREEPIK;
  const fp = FREEPIK_MODELS.find((m) => m.id === model.id);
  if (!fp) return { error: "Modelo inválido", status: 400 };

  const out = await startGeneration(config, fp, input);
  if ("error" in out) return out;
  if (out.kind === "images") return { kind: "images", images: out.images };
  return { kind: "task", taskId: out.taskId };
}

export type PollResult =
  | { status: "CREATED" | "IN_PROGRESS" | "COMPLETED" | "FAILED"; urls: string[] }
  | GenError;

export async function pollImage(model: ImageModelInfo, taskId: string): Promise<PollResult> {
  if (model.provider !== "freepik") return { error: "Esse modelo não gera em segundo plano", status: 400 };
  const config = await getFreepikConfig();
  if (!config) return NO_FREEPIK;
  const fp = FREEPIK_MODELS.find((m) => m.id === model.id);
  if (!fp) return { error: "Modelo inválido", status: 400 };
  return taskStatus(config, fp, taskId);
}
