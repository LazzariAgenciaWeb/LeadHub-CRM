import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import { readComments, sanitizeComments, CLICKUP_IMPORT_PREFIX, type TaskCommentAttachment } from "./checklist";
import { Prisma } from "@/generated/prisma";
import { getClickupSettings, fetchClickupTaskAttachments, uploadClickupAttachment, type ClickupAttachment } from "./clickup";
import { putObject, getObjectBuffer, storageEnabled, S3_BUCKET, MAX_FILE_BYTES } from "./storage/s3";
import { safeKeyName } from "./storage/access";

/**
 * Anexos entre a tarefa do LeadHub e a tarefa espelhada no ClickUp.
 *   • Trazer (ClickUp → LeadHub): a equipe escolhe quais anexos copiar pro
 *     storage do LeadHub — aí entram na peça do link de aprovação.
 *   • Enviar (LeadHub → ClickUp): arquivo subido numa tarefa ligada vai pro
 *     ClickUp sozinho.
 * StorageObject.clickupAttachmentId amarra os dois lados, então o que veio de
 * lá não volta, e o que foi pra lá aparece como "já no LeadHub".
 */

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", pdf: "application/pdf",
};

type LinkedTask = { id: string; projectId: string; clickupTaskId: string | null; comments: unknown; agencyId: string };

async function loadTask(taskId: string): Promise<LinkedTask | null> {
  const t = await prisma.projectTask.findUnique({
    where:  { id: taskId },
    select: { id: true, projectId: true, clickupTaskId: true, comments: true, project: { select: { setor: { select: { companyId: true } } } } },
  });
  return t ? { id: t.id, projectId: t.projectId, clickupTaskId: t.clickupTaskId, comments: t.comments, agencyId: t.project.setor.companyId } : null;
}

/** Anexos do ClickUp da tarefa, marcando os que já estão no LeadHub. */
export async function listClickupAttachments(taskId: string): Promise<(ClickupAttachment & { imported: boolean })[]> {
  const task = await loadTask(taskId);
  if (!task?.clickupTaskId) return [];
  const settings = await getClickupSettings(task.agencyId);
  if (!settings?.apiToken) throw new Error("ClickUp não configurado nesta empresa");
  const atts = await fetchClickupTaskAttachments(settings.apiToken, task.clickupTaskId);
  const have = await prisma.storageObject.findMany({
    where:  { projectTaskId: task.id, clickupAttachmentId: { in: atts.map((a) => a.id) } },
    select: { clickupAttachmentId: true },
  });
  const set = new Set(have.map((h) => h.clickupAttachmentId));
  return atts.map((a) => ({ ...a, imported: set.has(a.id) }));
}

/**
 * Copia anexos do ClickUp pro storage da tarefa. `ids` = quais trazer (vazio =
 * todos os que ainda não vieram). Vira um andamento "Trazido do ClickUp" com os
 * arquivos — igual ao "+ Anexar", então o cliente vê e a equipe marca status.
 */
export async function importClickupAttachments(
  taskId: string,
  ids: string[] | null,
  author: { id?: string | null; name?: string | null },
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  if (!storageEnabled()) throw new Error("Storage (MinIO) não configurado");
  const task = await loadTask(taskId);
  if (!task?.clickupTaskId) throw new Error("Tarefa não está ligada ao ClickUp");
  const settings = await getClickupSettings(task.agencyId);
  if (!settings?.apiToken) throw new Error("ClickUp não configurado nesta empresa");

  const all = await listClickupAttachments(taskId);
  const wanted = all.filter((a) => !a.imported && (!ids?.length || ids.includes(a.id)));

  const snaps: TaskCommentAttachment[] = [];
  const errors: string[] = [];
  for (const a of wanted) {
    try {
      if (a.size && a.size > MAX_FILE_BYTES) throw new Error("acima do limite de tamanho");
      // URL do anexo costuma abrir sem login; o token vai junto pro caso de
      // workspace com anexo privado.
      const res = await fetch(a.url, { headers: { Authorization: settings.apiToken }, cache: "no-store" });
      if (!res.ok) throw new Error(`download ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_FILE_BYTES) throw new Error("acima do limite de tamanho");

      const ext = a.extension.toLowerCase();
      const fileName = /\.[a-z0-9]{2,5}$/i.test(a.title) || !ext ? a.title : `${a.title}.${ext}`;
      const mimeType = a.mimeType || res.headers.get("content-type")?.split(";")[0] || MIME_BY_EXT[ext] || "application/octet-stream";
      const key = `companies/${task.agencyId}/project-tasks/${task.id}/${randomUUID()}/${safeKeyName(fileName)}`;
      await putObject(key, buf, mimeType);

      const obj = await prisma.storageObject.create({
        data: {
          companyId: task.agencyId, bucket: S3_BUCKET, key, fileName, mimeType, size: buf.length,
          status: "READY", projectTaskId: task.id, clickupAttachmentId: a.id, uploadedById: author.id ?? null,
        },
      });
      snaps.push({ id: obj.id, fileName, mimeType, size: buf.length });
    } catch (e: any) {
      errors.push(`${a.title}: ${e?.message ?? e}`);
    }
  }

  if (snaps.length) {
    const fresh = await prisma.projectTask.findUnique({ where: { id: task.id }, select: { comments: true } });
    const next = [...readComments(fresh?.comments), {
      text: `${CLICKUP_IMPORT_PREFIX} (${snaps.length} arquivo${snaps.length > 1 ? "s" : ""})`,
      at: new Date().toISOString(),
      attachments: snaps,
    }];
    await prisma.projectTask.update({ where: { id: task.id }, data: { comments: sanitizeComments(next) ?? Prisma.DbNull } });
    await prisma.projectTaskEvent.create({
      data: {
        taskId: task.id, projectId: task.projectId, type: "CLICKUP_IMPORT",
        toText: snaps.map((s) => s.fileName).join(", ").slice(0, 500),
        authorId: author.id ?? null, authorName: author.name ?? null,
      },
    }).catch(() => {});
  }
  return { imported: snaps.length, skipped: all.length - wanted.length, errors };
}

/**
 * Envia um arquivo da tarefa pro ClickUp (best-effort, chamado depois do
 * upload). Não faz nada se a tarefa não é ligada, se o arquivo veio do
 * ClickUp ou se já foi enviado.
 */
export async function pushFileToClickup(storageObjectId: string): Promise<void> {
  try {
    const obj = await prisma.storageObject.findUnique({
      where:  { id: storageObjectId },
      select: { id: true, key: true, fileName: true, mimeType: true, size: true, status: true, projectTaskId: true, clickupAttachmentId: true },
    });
    if (!obj?.projectTaskId || obj.clickupAttachmentId || obj.status !== "READY") return;
    if (obj.size > MAX_FILE_BYTES) return;
    const task = await loadTask(obj.projectTaskId);
    if (!task?.clickupTaskId) return;
    const settings = await getClickupSettings(task.agencyId);
    if (!settings?.apiToken) return;

    const buf = await getObjectBuffer(obj.key);
    const attId = await uploadClickupAttachment(settings.apiToken, task.clickupTaskId, buf, obj.fileName, obj.mimeType);
    await prisma.storageObject.update({ where: { id: obj.id }, data: { clickupAttachmentId: attId ?? "enviado" } });
  } catch (e) {
    console.error("[clickup-files] envio do anexo falhou:", e);
  }
}
