import { prisma } from "./prisma";
import { readComments } from "./checklist";

// Arquivos de tarefa (MinIO) vistos pelo CLIENTE no painel dele.
// Regra: o que está preso a um andamento só-interno (🔒) não aparece; o resto
// da tarefa visível aparece. Arquivo preso a andamento é mostrado dentro dele;
// os "soltos" (subidos antes do feed existir) vão numa seção própria.

export type ClientTaskFile = { id: string; fileName: string; mimeType: string };

export function fileVisibleToClient(comments: unknown, fileId: string): boolean {
  let inVisible = false;
  let inInternal = false;
  for (const c of readComments(comments)) {
    if (!c.attachments?.some((a) => a.id === fileId)) continue;
    if (c.vis === false && c.by !== "client") inInternal = true;
    else inVisible = true;
  }
  return inVisible || !inInternal;
}

export async function looseClientFiles(
  tasks: { id: string; comments: unknown }[],
): Promise<Record<string, ClientTaskFile[]>> {
  if (!tasks.length) return {};
  const referenced = new Set<string>();
  for (const t of tasks) {
    for (const c of readComments(t.comments)) {
      for (const a of c.attachments ?? []) referenced.add(a.id);
    }
  }
  const files = await prisma.storageObject.findMany({
    where:   { projectTaskId: { in: tasks.map((t) => t.id) }, status: "READY" },
    orderBy: { createdAt: "asc" },
    select:  { id: true, fileName: true, mimeType: true, projectTaskId: true },
  });
  const out: Record<string, ClientTaskFile[]> = {};
  for (const f of files) {
    if (!f.projectTaskId || referenced.has(f.id)) continue;
    (out[f.projectTaskId] ??= []).push({ id: f.id, fileName: f.fileName, mimeType: f.mimeType });
  }
  return out;
}
