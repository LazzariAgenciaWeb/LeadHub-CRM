import { prisma } from "./prisma";
import type { Ratio } from "./image-gen";

// Geração de imagem por IA no Freepik.
//
// A Freepik comprou a Magnific e migrou a doc pra docs.magnific.com: hoje
// `api.freepik.com` e `api.magnific.com` são o MESMO backend (mesma rota, mesma
// resposta) e a mesma chave vale nos dois. Mandamos os dois headers
// (`x-freepik-api-key` + `x-magnific-api-key`) pra não quebrar quando a
// migração terminar de um lado ou do outro.
//
// Dois jeitos de gerar, dependendo do modelo:
//   - sync: POST devolve a imagem em base64 na hora (clássico rápido);
//   - task: POST devolve `task_id` e a imagem aparece depois, consultando
//     GET <rota do modelo>/<task_id> até `status: COMPLETED`.
// Quem faz o polling é o navegador (a rota da tarefa expõe os dois passos) —
// assim nenhuma requisição fica 60s pendurada atravessando proxy.

const DEFAULT_BASE = "https://api.freepik.com";

export interface FreepikConfig {
  apiKey: string;
  baseUrl: string;
}

/** Chave da plataforma (Setting global, só SUPER_ADMIN grava). null = não configurada. */
export async function getFreepikConfig(): Promise<FreepikConfig | null> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ["freepik_api_key", "freepik_base_url"] } },
  });
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  const apiKey = map.freepik_api_key?.trim();
  if (!apiKey) return null;

  return {
    apiKey,
    baseUrl: (map.freepik_base_url?.trim() || DEFAULT_BASE).replace(/\/+$/, ""),
  };
}

// ─────────────────────────── Proporções ───────────────────────────
// A proporção canônica (o que a tela manda) vem de image-gen.ts. Cada modelo
// do Freepik aceita um vocabulário diferente — uns usam nome
// (`social_story_9_16`), outros a razão crua (`9:16`) — e nem todos aceitam
// todas, então o mapa é por modelo e cai na mais próxima quando falta.

const NAMED: Record<Ratio, string> = {
  "1:1":  "square_1_1",
  "4:5":  "social_post_4_5",
  "9:16": "social_story_9_16",
  "16:9": "widescreen_16_9",
  "3:4":  "traditional_3_4",
};

// Seedream não tem 4:5 — o mais próximo no catálogo dele é 3:4.
const NAMED_NO_4_5: Record<Ratio, string> = { ...NAMED, "4:5": "traditional_3_4" };

const COLON: Record<Ratio, string> = {
  "1:1": "1:1", "4:5": "4:5", "9:16": "9:16", "16:9": "16:9", "3:4": "3:4",
};

// ─────────────────────────── Modelos ───────────────────────────

export interface GenerateInput {
  prompt: string;
  ratio: Ratio;
  numImages: number;
}

export interface FreepikModel {
  id: string;
  label: string;
  desc: string;
  /** Rota do POST (a de status é a mesma + /<task_id>). */
  path: string;
  mode: "sync" | "task";
  /** Quantas imagens o modelo gera por chamada (só o clássico aceita > 1). */
  maxImages: number;
  body: (input: GenerateInput) => Record<string, unknown>;
}

export const MODELS: FreepikModel[] = [
  {
    id: "classic",
    label: "Clássico rápido",
    desc: "Resposta na hora, mais barato. Bom pra testar ideia e variação.",
    path: "/v1/ai/text-to-image",
    mode: "sync",
    maxImages: 4,
    body: ({ prompt, ratio, numImages }) => ({
      prompt,
      num_images: numImages,
      image: { size: NAMED[ratio] },
    }),
  },
  {
    id: "mystic",
    label: "Mystic (realismo)",
    desc: "O melhor do Freepik em foto realista. Leva alguns segundos.",
    path: "/v1/ai/mystic",
    mode: "task",
    maxImages: 1,
    body: ({ prompt, ratio }) => ({
      prompt,
      aspect_ratio: NAMED[ratio],
      resolution: "2k",
      model: "realism",
    }),
  },
  {
    id: "nano-banana-pro",
    label: "Nano Banana Pro (Google)",
    desc: "Melhor com texto dentro da imagem — post com frase, preço, selo.",
    path: "/v1/ai/text-to-image/nano-banana-pro",
    mode: "task",
    maxImages: 1,
    body: ({ prompt, ratio }) => ({
      prompt,
      aspect_ratio: COLON[ratio],
      resolution: "2K",
    }),
  },
  {
    id: "seedream-v5-pro",
    label: "Seedream 5 Pro",
    desc: "Composição caprichada e estilo gráfico. Leva alguns segundos.",
    path: "/v1/ai/text-to-image/seedream-v5-pro",
    mode: "task",
    maxImages: 1,
    body: ({ prompt, ratio }) => ({
      prompt,
      aspect_ratio: NAMED_NO_4_5[ratio],
      resolution: "2k",
    }),
  },
];

export function findModel(id: string | undefined): FreepikModel | null {
  return MODELS.find((m) => m.id === id) ?? null;
}

// ─────────────────────────── Chamadas ───────────────────────────

export type FreepikError = { error: string; status: number };

export type StartResult =
  /** Modelo sync: imagens já vieram (base64 puro, sem prefixo data:). */
  | { kind: "images"; images: string[] }
  /** Modelo task: a imagem fica pronta depois — consultar com taskStatus(). */
  | { kind: "task"; taskId: string; status: TaskStatus };

export type TaskStatus = "CREATED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

function headers(config: FreepikConfig) {
  return {
    "Content-Type": "application/json",
    "x-freepik-api-key": config.apiKey,
    "x-magnific-api-key": config.apiKey,
  };
}

/** Mensagem de erro da API (ela responde `{ message }`) ou o texto cru. */
async function readError(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "");
  try {
    const body = JSON.parse(raw);
    const msg = body?.message ?? body?.error;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
    if (Array.isArray(body?.invalid_params) && body.invalid_params.length) {
      return body.invalid_params.map((p: any) => `${p.field ?? "campo"}: ${p.reason ?? "inválido"}`).join("; ");
    }
  } catch { /* não era JSON */ }
  return raw.slice(0, 300) || `Erro ${res.status} na API do Freepik`;
}

/** Dispara a geração. Sync devolve as imagens; task devolve o id pra consultar. */
export async function startGeneration(
  config: FreepikConfig,
  model: FreepikModel,
  input: GenerateInput,
): Promise<StartResult | FreepikError> {
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}${model.path}`, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify(model.body(input)),
      cache: "no-store",
    });
  } catch (err) {
    console.error("[Freepik] startGeneration exception:", err);
    return { error: "Não foi possível falar com a API do Freepik", status: 502 };
  }

  if (!res.ok) {
    const message = await readError(res);
    console.error("[Freepik] startGeneration:", res.status, message);
    // 401/402 são da conta (chave inválida, sem crédito) — o resto é da chamada.
    return { error: message, status: res.status === 401 || res.status === 402 ? res.status : 502 };
  }

  const data = await res.json().catch(() => null);

  if (model.mode === "sync") {
    const images = Array.isArray(data?.data)
      ? data.data.map((d: any) => d?.base64).filter((b: unknown): b is string => typeof b === "string" && !!b)
      : [];
    if (!images.length) return { error: "A API não devolveu imagem", status: 502 };
    return { kind: "images", images };
  }

  const taskId = data?.data?.task_id;
  if (typeof taskId !== "string" || !taskId) {
    return { error: "A API não devolveu o id da geração", status: 502 };
  }
  return { kind: "task", taskId, status: (data?.data?.status as TaskStatus) ?? "CREATED" };
}

/** Consulta uma geração assíncrona. `urls` só vem preenchido em COMPLETED. */
export async function taskStatus(
  config: FreepikConfig,
  model: FreepikModel,
  taskId: string,
): Promise<{ status: TaskStatus; urls: string[] } | FreepikError> {
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}${model.path}/${encodeURIComponent(taskId)}`, {
      headers: headers(config),
      cache: "no-store",
    });
  } catch (err) {
    console.error("[Freepik] taskStatus exception:", err);
    return { error: "Não foi possível falar com a API do Freepik", status: 502 };
  }

  if (!res.ok) {
    const message = await readError(res);
    console.error("[Freepik] taskStatus:", res.status, message);
    return { error: message, status: res.status === 404 ? 404 : 502 };
  }

  const data = await res.json().catch(() => null);
  const urls = Array.isArray(data?.data?.generated)
    ? data.data.generated.filter((u: unknown): u is string => typeof u === "string" && !!u)
    : [];
  return { status: (data?.data?.status as TaskStatus) ?? "IN_PROGRESS", urls };
}

/** Baixa a imagem pronta do CDN do Freepik pra gravar no nosso storage. */
export async function downloadImage(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error("[Freepik] downloadImage:", res.status, url);
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = (res.headers.get("content-type") ?? "image/png").split(";")[0].trim();
    return { buffer, mimeType: mimeType.startsWith("image/") ? mimeType : "image/png" };
  } catch (err) {
    console.error("[Freepik] downloadImage exception:", err);
    return null;
  }
}

/** Testa a chave: o endpoint de LoRAs do Mystic é leve e não gasta crédito. */
export async function testApiKey(config: FreepikConfig): Promise<{ ok: true } | FreepikError> {
  try {
    const res = await fetch(`${config.baseUrl}/v1/ai/loras`, { headers: headers(config), cache: "no-store" });
    if (res.ok) return { ok: true };
    return { error: await readError(res), status: res.status };
  } catch {
    return { error: "Não foi possível falar com a API do Freepik", status: 502 };
  }
}
