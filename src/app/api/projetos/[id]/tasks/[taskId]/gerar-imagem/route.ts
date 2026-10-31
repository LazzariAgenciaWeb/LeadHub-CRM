import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { authorizeTarget } from "@/lib/storage/access";
import { storageEnabled } from "@/lib/storage/s3";
import { attachImageToTask, fileNameFor } from "@/lib/task-image";
import {
  findImageModel, isRatio, startImage, pollImage, downloadImage, listImageModels,
  configuredProviders, RATIOS, type ImageModelInfo, type Ratio,
} from "@/lib/image-gen";

// Geração de imagem por IA DENTRO da tarefa de arte (Freepik ou OpenAI).
//
// POST  dispara a geração. Modelo síncrono já volta com a imagem anexada;
//       modelo assíncrono (Freepik) volta { taskId } e o navegador consulta o GET.
// GET   sem parâmetro: catálogo de modelos + quais provedores têm chave.
// GET   ?taskId=…&model=…  consulta a geração; quando fica pronta, baixa a
//       imagem do CDN do provedor, grava no nosso storage e anexa na tarefa.
//
// Sem MinIO configurado (storageEnabled false) nada é anexado: devolvemos a
// imagem pra tela mesmo assim, pra dar pra testar prompt e modelo antes do
// storage subir. A UI avisa que não foi salva.

/** Sessão + permissão na tarefa (inclui o gate do módulo Projetos). */
async function guard(projectId: string, taskId: string) {
  const session = await getEffectiveSession();
  if (!session) return { fail: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };

  const auth = await authorizeTarget(session, { kind: "projectTask", projectTaskId: taskId }, { write: true });
  if (!auth.ok) return { fail: NextResponse.json({ error: auth.error }, { status: auth.status }) };

  // A tarefa tem que ser DESTE projeto — a URL diz os dois.
  const task = await prisma.projectTask.findUnique({ where: { id: taskId }, select: { projectId: true } });
  if (!task || task.projectId !== projectId) {
    return { fail: NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 }) };
  }

  return { session, companyId: auth.companyId };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const { id, taskId } = await params;
  const g = await guard(id, taskId);
  if (g.fail) return g.fail;

  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt ?? "").trim();
  if (prompt.length < 3) return NextResponse.json({ error: "Descreva a imagem (mínimo 3 caracteres)." }, { status: 400 });
  if (prompt.length > 4000) return NextResponse.json({ error: "Descrição muito longa (máx. 4000 caracteres)." }, { status: 400 });

  const model = findImageModel(String(body?.model ?? ""));
  if (!model) return NextResponse.json({ error: "Modelo inválido" }, { status: 400 });

  const ratio: Ratio = isRatio(body?.ratio) ? body.ratio : "1:1";
  const numImages = Math.min(Math.max(Number(body?.numImages ?? 1) || 1, 1), model.maxImages);

  const result = await startImage(model, { prompt, ratio, numImages });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  if (result.kind === "task") {
    return NextResponse.json({ pending: true, taskId: result.taskId, model: model.id });
  }

  // Síncrono: as imagens já vieram em base64.
  const images = result.images.map((b64) => ({ buffer: Buffer.from(b64, "base64"), mimeType: "image/png" }));
  return NextResponse.json(await finish(g, taskId, model, prompt, images));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const { id, taskId } = await params;
  const g = await guard(id, taskId);
  if (g.fail) return g.fail;

  const sp = req.nextUrl.searchParams;
  const genId = (sp.get("taskId") ?? "").trim();
  const prompt = (sp.get("prompt") ?? "").trim();

  // Sem taskId: a tela está abrindo e quer saber o que pode usar.
  if (!genId) {
    return NextResponse.json({
      models: listImageModels(),
      ratios: RATIOS,
      providers: await configuredProviders(),
      storageOff: !storageEnabled(),
    });
  }

  const model = findImageModel(sp.get("model"));
  if (!model) return NextResponse.json({ error: "Modelo inválido" }, { status: 400 });

  const status = await pollImage(model, genId);
  if ("error" in status) return NextResponse.json({ error: status.error }, { status: status.status });

  if (status.status === "FAILED") {
    return NextResponse.json({ error: "O provedor não conseguiu gerar essa imagem. Ajuste a descrição e tente de novo." }, { status: 502 });
  }
  if (status.status !== "COMPLETED" || status.urls.length === 0) {
    return NextResponse.json({ pending: true, status: status.status });
  }

  // Pronta: baixa do CDN do provedor (as URLs expiram) e guarda aqui.
  const downloaded: { buffer: Buffer; mimeType: string }[] = [];
  for (const url of status.urls) {
    const img = await downloadImage(url);
    if (img) downloaded.push(img);
  }
  if (!downloaded.length) {
    return NextResponse.json({ error: "Imagem gerada, mas não foi possível baixá-la do provedor." }, { status: 502 });
  }

  return NextResponse.json(await finish(g, taskId, model, prompt, downloaded, status.urls));
}

/** Anexa o que veio (quando há storage) e monta a resposta pra tela. */
async function finish(
  g: { session: any; companyId: string },
  projectTaskId: string,
  model: ImageModelInfo,
  prompt: string,
  images: { buffer: Buffer; mimeType: string }[],
  sourceUrls?: string[],
) {
  // Sem MinIO: mostra a imagem na tela (base64) e avisa que não foi anexada.
  if (!storageEnabled()) {
    return {
      attached: false,
      storageOff: true,
      model: model.id,
      prompt,
      previews: images.map((img, i) => ({
        dataUrl: `data:${img.mimeType};base64,${img.buffer.toString("base64")}`,
        sourceUrl: sourceUrls?.[i] ?? null,
      })),
      files: [],
    };
  }

  const files = [];
  for (const [i, img] of images.entries()) {
    files.push(
      await attachImageToTask({
        companyId: g.companyId,
        projectTaskId,
        userId:   (g.session.user as any)?.id ?? null,
        userName: (g.session.user as any)?.name ?? null,
        buffer: img.buffer,
        mimeType: img.mimeType,
        fileName: fileNameFor(prompt, img.mimeType, i),
      }),
    );
  }
  return { attached: true, storageOff: false, model: model.id, prompt, files, previews: [] };
}
