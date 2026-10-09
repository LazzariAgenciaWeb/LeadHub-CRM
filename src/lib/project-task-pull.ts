import { prisma } from "@/lib/prisma";
import { fetchClickupTaskDescription, fetchClickupTaskComments, getClickupSettings, fetchClickupTaskLite, type ClickupTaskLite } from "@/lib/clickup";
import { listClickupAttachments } from "@/lib/clickup-files";
import { readComments, sanitizeComments } from "@/lib/checklist";

export type LinkedTask = {
  id: string;
  clickupTaskId: string | null;
  comments: unknown;
  description: string | null;
  updatedAt: Date;
  done: boolean;
};

export const LINKED_TASK_SELECT = {
  id: true, clickupTaskId: true, comments: true, description: true, updatedAt: true, done: true,
} as const;

/**
 * ClickUp → tarefa interna vinculada. Usado pelo sync do projeto inteiro e pelo
 * "Sincronizar" de UMA tarefa (modal), pra os dois nunca divergirem.
 *
 * "Quem venceu a corrida": título/prazo/início/descritivo só são sobrescritos
 * quando o ClickUp foi atualizado DEPOIS da última edição no LeadHub — edição
 * local mais nova é preservada. Comentários são append-only (merge sem eco).
 */
export async function pullClickupIntoTask(apiToken: string, lt: LinkedTask, src: ClickupTaskLite): Promise<void> {
  const remoteMs   = src.dateUpdated ?? 0;
  const remoteWins = remoteMs > lt.updatedAt.getTime();

  // Descritivo: quando o remote é mais novo OU ainda não há descritivo local
  // (tarefa recém-espelhada nasce sem descrição). Best-effort.
  const noLocalDesc = !lt.description || !lt.description.trim();
  let desc: string | null = null;
  if (remoteWins || noLocalDesc) {
    try { desc = (await fetchClickupTaskDescription(apiToken, lt.clickupTaskId!)) || null; } catch { /* silencioso */ }
  }

  // Comentários do ClickUp → andamento. Pula os que já temos por id do ClickUp
  // (inclui os que o LeadHub empurrou — evita eco) ou por texto+data (antigos).
  let mergedComments: ReturnType<typeof sanitizeComments> | undefined;
  try {
    const cmts = await fetchClickupTaskComments(apiToken, lt.clickupTaskId!);
    const existing = readComments(lt.comments);
    const seen = new Set(existing.map((c) => `${c.text}|${c.at}`));
    const seenCid = new Set(existing.map((c) => c.cid).filter(Boolean));
    const fresh = cmts.filter((c) => !(c.cid && seenCid.has(c.cid)) && !seen.has(`${c.text}|${c.at}`));
    if (fresh.length) {
      mergedComments = sanitizeComments(
        [...existing, ...fresh].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
      );
    }
  } catch { /* silencioso */ }

  // Concluído: só mexe quando MUDOU. Antes gravava done/completedAt a cada
  // sync (a data de conclusão "andava") e não tocava no status — que é a fonte
  // única do andamento —, deixando tarefa concluída no ClickUp como "Nova" aqui.
  const doneChange =
    src.isCompleted && !lt.done
      ? { done: true, completedAt: new Date(), status: "APROVADO", awaitingClient: false }
      : !src.isCompleted && lt.done
        ? { done: false, completedAt: null, status: "EM_PRODUCAO" }
        : {};

  await prisma.projectTask.update({
    where: { id: lt.id },
    data: {
      ...(remoteWins && src.name ? { title: src.name } : {}),
      ...(desc ? { description: desc } : {}),
      ...(remoteWins ? { dueDate:   src.dueDate   != null ? new Date(src.dueDate)   : null } : {}),
      ...(remoteWins ? { startDate: src.startDate != null ? new Date(src.startDate) : null } : {}),
      ...doneChange,
      ...(mergedComments ? { comments: mergedComments } : {}),
    },
  }).catch(() => {});
}

// ─── Sincronizar UMA tarefa (botão do modal + webhook em tempo real) ─────────

const IMAGE_EXT = /^(png|jpe?g|webp|gif|avif|heic)$/i;

export type OneTaskSyncResult =
  | { ok: true; pendingImages: number }
  | { ok: false; error: string; status: number };

/**
 * Puxa do ClickUp só esta tarefa: título, datas, descritivo, comentários e
 * conclusão (pullClickupIntoTask). Anexos NÃO entram sozinhos: nem toda imagem
 * do ClickUp é peça pro cliente (rascunho, referência, versão descartada) —
 * só conta quantas imagens novas existem, e a equipe escolhe no "Trazer" do
 * quadro "Anexos no ClickUp".
 *
 * Serializado por tarefa: o ClickUp dispara vários eventos juntos (taskUpdated
 * + taskStatusUpdated…) e não vale gravar a mesma tarefa em paralelo. Um
 * processo só (container único) → fila em memória basta.
 */
const running = new Map<string, Promise<OneTaskSyncResult>>();

export function syncOneProjectTask(taskId: string): Promise<OneTaskSyncResult> {
  const prev = running.get(taskId) ?? Promise.resolve(null as unknown as OneTaskSyncResult);
  const next = prev.catch(() => null).then(() => doSyncOne(taskId));
  running.set(taskId, next);
  void next.finally(() => { if (running.get(taskId) === next) running.delete(taskId); });
  return next;
}

async function doSyncOne(taskId: string): Promise<OneTaskSyncResult> {
  const task = await prisma.projectTask.findUnique({
    where:  { id: taskId },
    select: { ...LINKED_TASK_SELECT, project: { select: { setor: { select: { companyId: true } } } } },
  });
  if (!task) return { ok: false, error: "Tarefa não encontrada", status: 404 };
  if (!task.clickupTaskId) return { ok: false, error: "Esta tarefa não está ligada ao ClickUp.", status: 400 };

  const settings = await getClickupSettings(task.project.setor.companyId);
  if (!settings?.apiToken) return { ok: false, error: "ClickUp não configurado nesta empresa.", status: 503 };

  const remote = await fetchClickupTaskLite(settings.apiToken, task.clickupTaskId);
  if (!remote) return { ok: false, error: "Não consegui ler a tarefa no ClickUp (apagada ou sem acesso?).", status: 502 };
  await pullClickupIntoTask(settings.apiToken, task, remote.task);

  let pendingImages = 0;
  try {
    const atts = await listClickupAttachments(taskId);
    pendingImages = atts.filter((a) => !a.imported && (/^image\//i.test(a.mimeType) || IMAGE_EXT.test(a.extension))).length;
  } catch { /* só informativo */ }
  return { ok: true, pendingImages };
}
