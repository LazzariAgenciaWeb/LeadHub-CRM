import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { safeKeyName } from "@/lib/storage/access";
import { storageEnabled, putObject, S3_BUCKET } from "@/lib/storage/s3";
import { pushFileToClickup } from "@/lib/clickup-files";
import {
  findImageModel, startImage, pollImage, downloadImage,
  type ImageModelInfo, type Ratio,
} from "@/lib/image-gen";

/**
 * Gerar imagem por IA e anexar na tarefa — a parte que NÃO depende de sessão
 * web, pra a tela do projeto e o assistente (MCP) fazerem a mesma coisa.
 *
 * A tela dispara e consulta em dois passos, porque quem espera é o navegador e
 * ele mostra "gerando…". O assistente não tem onde mostrar isso: aqui a função
 * espera a imagem ficar pronta e devolve o arquivo já anexado, numa chamada só.
 */

const PUBLIC_FIELDS = {
  id: true, fileName: true, mimeType: true, size: true, createdAt: true,
  ticketMessageId: true, uploadedById: true,
  uploadedBy: { select: { name: true } },
} as const;

export function extOf(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

/** ia-<resumo-do-prompt>-<carimbo>.png — dá pra reconhecer o arquivo na lista. */
export function fileNameFor(prompt: string, mimeType: string, index: number): string {
  const slug = prompt
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 40) || "imagem";
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return `ia-${slug}-${stamp}${index > 0 ? `-${index + 1}` : ""}.${extOf(mimeType)}`;
}

/** Grava a imagem no bucket, registra o StorageObject e anexa na tarefa. */
export async function attachImageToTask(opts: {
  companyId: string;
  projectTaskId: string;
  /** Quem fica como autor do anexo (null = automação sem usuário). */
  userId: string | null;
  userName: string | null;
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}) {
  const id = randomUUID();
  const key = `companies/${opts.companyId}/project-tasks/${opts.projectTaskId}/${id}/${safeKeyName(opts.fileName)}`;
  await putObject(key, opts.buffer, opts.mimeType);

  // Já nasce READY: o upload foi feito aqui no servidor, não tem passo do
  // navegador pra confirmar (é o que o /api/storage/[id]/complete faz).
  const file = await prisma.storageObject.create({
    data: {
      companyId:     opts.companyId,
      bucket:        S3_BUCKET,
      key,
      fileName:      opts.fileName,
      mimeType:      opts.mimeType,
      size:          opts.buffer.length,
      status:        "READY",
      projectTaskId: opts.projectTaskId,
      uploadedById:  opts.userId,
    },
    select: PUBLIC_FIELDS,
  });

  // Mesmo feed de ações do upload manual: "X anexou arquivo.png".
  const task = await prisma.projectTask.findUnique({
    where:  { id: opts.projectTaskId },
    select: { projectId: true },
  });
  if (task) {
    await prisma.projectTaskEvent.create({
      data: {
        taskId: opts.projectTaskId, projectId: task.projectId, type: "FILE",
        fromText: file.id, toText: file.fileName,
        authorId: opts.userId, authorName: opts.userName,
      },
    }).catch(() => {});
  }
  // Tarefa espelhada no ClickUp: o arquivo vai pra lá também (em segundo plano).
  void pushFileToClickup(file.id);

  return file;
}

export type GeneratedForTask =
  | {
      ok: true;
      model: ImageModelInfo;
      prompt: string;
      /** Vazio quando o storage está desligado — aí nada foi anexado. */
      files: Awaited<ReturnType<typeof attachImageToTask>>[];
      /** URLs no CDN do provedor. Expiram; servem só de diagnóstico. */
      sourceUrls: string[];
      attached: boolean;
    }
  | { ok: false; reason: string };

/** Quanto esperamos a imagem assíncrona ficar pronta antes de desistir. */
const ESPERA_MAX_MS = 120_000;
const INTERVALO_MS  = 3_000;

const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Gera a imagem e anexa na tarefa, esperando o provedor terminar.
 *
 * Modelo síncrono volta com a imagem no próprio POST; os assíncronos (Mystic,
 * Nano Banana, Seedream) devolvem um id e ficam prontos em alguns segundos —
 * consultamos até `ESPERA_MAX_MS`. Sem storage configurado a imagem é gerada e
 * perdida, então não geramos: cobrar crédito do provedor por um arquivo que não
 * vai ficar em lugar nenhum é pior que recusar.
 */
export async function generateImageForTask(opts: {
  companyId: string;
  projectTaskId: string;
  userId: string | null;
  userName: string | null;
  prompt: string;
  ratio: Ratio;
  modelId: string;
  numImages?: number;
}): Promise<GeneratedForTask> {
  if (!storageEnabled()) {
    return {
      ok: false,
      reason: "O storage de arquivos (MinIO) não está configurado — a imagem seria gerada e perdida, sem ter onde anexar. Configure o storage antes.",
    };
  }

  const model = findImageModel(opts.modelId);
  if (!model) {
    return { ok: false, reason: `Modelo "${opts.modelId}" não existe. Use listar_modelos_imagem pra ver os disponíveis.` };
  }

  const numImages = Math.min(Math.max(opts.numImages ?? 1, 1), model.maxImages);
  const started = await startImage(model, { prompt: opts.prompt, ratio: opts.ratio, numImages });
  if ("error" in started) return { ok: false, reason: started.error };

  let imagens: { buffer: Buffer; mimeType: string }[] = [];
  let sourceUrls: string[] = [];

  if (started.kind === "images") {
    imagens = started.images.map((b64) => ({ buffer: Buffer.from(b64, "base64"), mimeType: "image/png" }));
  } else {
    const limite = Date.now() + ESPERA_MAX_MS;
    let urls: string[] | null = null;
    while (Date.now() < limite) {
      await dorme(INTERVALO_MS);
      const st = await pollImage(model, started.taskId);
      if ("error" in st) return { ok: false, reason: st.error };
      if (st.status === "FAILED") {
        return { ok: false, reason: "O provedor não conseguiu gerar essa imagem. Ajuste a descrição e tente de novo." };
      }
      if (st.status === "COMPLETED" && st.urls.length > 0) { urls = st.urls; break; }
    }
    if (!urls) {
      return { ok: false, reason: `A imagem ainda não ficou pronta em ${ESPERA_MAX_MS / 1000}s. Tente de novo, ou use um modelo mais rápido (classic).` };
    }
    sourceUrls = urls;
    for (const url of urls) {
      const img = await downloadImage(url);
      if (img) imagens.push(img);
    }
    if (!imagens.length) {
      return { ok: false, reason: "Imagem gerada, mas não foi possível baixá-la do provedor." };
    }
  }

  const files = [];
  for (const [i, img] of imagens.entries()) {
    files.push(
      await attachImageToTask({
        companyId:     opts.companyId,
        projectTaskId: opts.projectTaskId,
        userId:        opts.userId,
        userName:      opts.userName,
        buffer:        img.buffer,
        mimeType:      img.mimeType,
        fileName:      fileNameFor(opts.prompt, img.mimeType, i),
      }),
    );
  }

  return { ok: true, model, prompt: opts.prompt, files, sourceUrls, attached: true };
}
