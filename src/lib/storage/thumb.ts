import { getObjectBuffer, putObject, deleteObject } from "./s3";

/**
 * Versões leves de imagem, só pra VER (miniatura e carrossel de aprovação).
 * Arte exportada do ChatGPT/Canva vem em PNG de vários MB; carregar o original
 * em cada miniatura deixava a tarefa e o link de aprovação lentos.
 *
 *   thumb — 480 px no maior lado: miniaturas (lista de anexos, linha do tempo).
 *   view  — 1600 px no maior lado: a arte grande do carrossel, nítida no
 *           celular e no computador, com uma fração do peso.
 *
 * O ORIGINAL não muda: "Baixar" e "Abrir" continuam entregando o arquivo com a
 * qualidade de quem subiu. A versão leve é gerada na 1ª vez que alguém pede e
 * fica guardada no MinIO ao lado do original (mesma chave + sufixo), então o
 * custo de redimensionar é uma vez só.
 */

export type ImageVariant = "thumb" | "view";

const SIZES: Record<ImageVariant, { px: number; quality: number }> = {
  thumb: { px: 480,  quality: 72 },
  view:  { px: 1600, quality: 82 },
};

/** Formatos que vale reduzir. GIF fica de fora (animação viraria 1 quadro). */
const RESIZABLE = /^image\/(png|jpe?g|webp|avif)$/i;

export function canResize(mimeType: string): boolean {
  return RESIZABLE.test(mimeType);
}

export function parseVariant(v: string | null): ImageVariant | null {
  return v === "thumb" || v === "view" ? v : null;
}

export function variantKey(key: string, v: ImageVariant): string {
  return `${key}.${v}-${SIZES[v].px}.webp`;
}

// Pedidos simultâneos da mesma versão (várias miniaturas abrindo juntas)
// geram uma vez só.
const inflight = new Map<string, Promise<Buffer | null>>();
// Originais que já são leves (a versão reduzida não ficou menor): não tenta de novo.
const notWorth = new Set<string>();

/**
 * Bytes da versão leve (webp). null = não deu (formato, arquivo corrompido,
 * sharp indisponível) — quem chamou cai no original.
 */
export async function imageVariant(obj: { key: string; mimeType: string }, v: ImageVariant): Promise<Buffer | null> {
  if (!canResize(obj.mimeType)) return null;
  const vKey = variantKey(obj.key, v);
  if (notWorth.has(vKey)) return null;
  const running = inflight.get(vKey);
  if (running) return running;

  const job = (async () => {
    try {
      return await getObjectBuffer(vKey);
    } catch { /* ainda não existe: gera */ }
    try {
      const sharp = (await import("sharp")).default;
      const src = await getObjectBuffer(obj.key);
      const { px, quality } = SIZES[v];
      const out = await sharp(src, { limitInputPixels: 100_000_000 })
        .rotate() // respeita a orientação da foto do celular (EXIF)
        .resize({ width: px, height: px, fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
      // Original já pequeno (ex.: JPG de 150 KB) pode sair maior em webp: aí
      // não vale guardar — devolve null e quem chamou usa o original.
      if (out.length >= src.length) {
        if (notWorth.size > 5000) notWorth.clear();
        notWorth.add(vKey);
        return null;
      }
      await putObject(vKey, out, "image/webp").catch((e) => console.error("[thumb] não guardou:", e));
      return out;
    } catch (e) {
      console.error("[thumb] falhou ao gerar", v, obj.key, e);
      return null;
    }
  })();
  inflight.set(vKey, job);
  try {
    return await job;
  } finally {
    inflight.delete(vKey);
  }
}

/** Resposta da versão leve. O cache longo é seguro: o arquivo de um id nunca muda. */
export function variantResponse(buf: Buffer): Response {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type":  "image/webp",
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=604800, immutable",
    },
  });
}

/** Apaga as versões leves junto com o original. */
export async function deleteImageVariants(key: string): Promise<void> {
  await Promise.all((Object.keys(SIZES) as ImageVariant[]).map((v) => deleteObject(variantKey(key, v)).catch(() => {})));
}
