import { prisma } from "@/lib/prisma";
import { isOverdueByDay } from "@/lib/datetime";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClickupSettings {
  apiToken: string;
  oportunidadesListId: string;
  ticketsListId: string;
  statusGanho: string;             // nome do status ClickUp quando oportunidade é ganha (default: "ganho")
  statusPerdido: string;           // nome do status ClickUp quando oportunidade é perdida (default: "perdido")
  statusChamadoConcluido: string;  // status ClickUp quando chamado é RESOLVED/CLOSED no LeadHub.
                                   // Vazio = não força status no update (mantém o que está no ClickUp).
}

// ── Config ────────────────────────────────────────────────────────────────────

const BASE = "https://api.clickup.com/api/v2";

// Status mapping: LeadHub priority → ClickUp priority number
const PRIORITY_MAP: Record<string, number> = {
  URGENT: 1,
  HIGH:   2,
  MEDIUM: 3,
  LOW:    4,
};

// LeadHub ticket status → ClickUp status. Só mapeamos os status FINAIS
// (RESOLVED/CLOSED) usando o valor configurado pela empresa em
// Configurações → ClickUp → "Status quando concluído". Para os demais
// (OPEN/IN_PROGRESS) não tocamos no status do ClickUp — cada conta usa
// nomenclatura diferente ("a fazer" / "to do" / "novo" / etc.) e errar o
// nome retorna 400 e quebra o sync silenciosamente.
function mapTicketStatus(
  leadHubStatus: string,
  statusChamadoConcluido: string,
): string | undefined {
  if (leadHubStatus === "RESOLVED" || leadHubStatus === "CLOSED") {
    return statusChamadoConcluido?.trim() || undefined;
  }
  return undefined;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Carrega as configurações ClickUp da empresa. **Sempre per-empresa** —
 * cada empresa-cliente conecta a própria conta ClickUp. Não tem fallback
 * global (chaves `clickup_api_token`, `clickup_*_list_id` sem sufixo são
 * legacy e ignoradas). Também checa `Company.moduleClickup` — se o módulo
 * estiver desligado, retorna null (sync desativado pra essa empresa).
 *
 * Retorna null se:
 *   - companyId não informado
 *   - empresa não existe ou moduleClickup=false
 *   - token não configurado
 */
export async function getClickupSettings(companyId?: string): Promise<ClickupSettings | null> {
  if (!companyId) return null;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { moduleClickup: true } as any,
  });
  if (!company || !(company as any).moduleClickup) return null;

  const keys = [
    `clickup_api_token:${companyId}`,
    `clickup_oportunidades_list_id:${companyId}`,
    `clickup_tickets_list_id:${companyId}`,
    `clickup_status_ganho:${companyId}`,
    `clickup_status_perdido:${companyId}`,
    `clickup_status_chamado_concluido:${companyId}`,
  ];
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  const apiToken               = map[`clickup_api_token:${companyId}`]?.trim()                ?? "";
  const oportunidadesListId    = map[`clickup_oportunidades_list_id:${companyId}`]?.trim()    ?? "";
  const ticketsListId          = map[`clickup_tickets_list_id:${companyId}`]?.trim()          ?? "";
  const statusGanho            = map[`clickup_status_ganho:${companyId}`]?.trim()             || "ganho";
  const statusPerdido          = map[`clickup_status_perdido:${companyId}`]?.trim()           || "perdido";
  const statusChamadoConcluido = map[`clickup_status_chamado_concluido:${companyId}`]?.trim() ?? "";

  if (!apiToken) return null;
  return { apiToken, oportunidadesListId, ticketsListId, statusGanho, statusPerdido, statusChamadoConcluido };
}

/**
 * Lê o webhook secret HMAC per-empresa.
 * Retorna null se a empresa não tiver módulo ClickUp ativo ou secret salvo.
 * Usado pelo handler `/api/webhook/clickup/[companyId]`.
 */
export async function getClickupWebhookSecret(companyId?: string): Promise<string | null> {
  if (!companyId) return null;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { moduleClickup: true } as any,
  });
  if (!company || !(company as any).moduleClickup) return null;

  const row = await prisma.setting.findUnique({
    where: { key: `clickup_webhook_secret:${companyId}` },
  });
  return row?.value?.trim() || null;
}

/** Create a ClickUp task in a given list. Returns the new task ID or null on failure. */
export async function createClickupTask({
  apiToken,
  listId,
  name,
  description,
  priority,
  status,
  dueDate,
  tags = [],
}: {
  apiToken: string;
  listId: string;
  name: string;
  description?: string;
  priority?: string;   // "URGENT" | "HIGH" | "MEDIUM" | "LOW"
  status?: string;     // ClickUp status name on the target list
  dueDate?: number;    // epoch ms
  tags?: string[];
}): Promise<string | null> {
  if (!listId) return null;
  try {
    const body: Record<string, unknown> = { name };
    if (description)               body.description  = description;
    if (priority && PRIORITY_MAP[priority]) body.priority = PRIORITY_MAP[priority];
    if (status)                    body.status       = status;
    if (dueDate)                   body.due_date     = dueDate;
    if (tags.length)               body.tags         = tags;

    const res = await fetch(`${BASE}/list/${listId}/task`, {
      method: "POST",
      headers: { Authorization: apiToken, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("[ClickUp] createTask failed", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return (data.id as string) ?? null;
  } catch (err) {
    console.error("[ClickUp] createTask error", err);
    return null;
  }
}

/** Update a ClickUp task (status, priority, name, etc.). */
export async function updateClickupTask({
  apiToken,
  taskId,
  name,
  description,
  priority,
  status,
  archived,
}: {
  apiToken: string;
  taskId: string;
  name?: string;
  description?: string;
  priority?: string;
  status?: string;
  archived?: boolean;
}): Promise<boolean> {
  if (!taskId) return false;
  try {
    const body: Record<string, unknown> = {};
    if (name)        body.name        = name;
    if (description) body.description = description;
    if (priority && PRIORITY_MAP[priority]) body.priority = PRIORITY_MAP[priority];
    if (status)      body.status      = status;
    if (archived !== undefined) body.archived = archived;

    const res = await fetch(taskApiUrl(taskId, ""), {
      method: "PUT",
      headers: { Authorization: apiToken, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("[ClickUp] updateTask failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[ClickUp] updateTask error", err);
    return false;
  }
}

/** Add a comment to a ClickUp task. Returns the new comment ID (string) or null on failure.
 *  O ID é guardado em TicketMessage.externalId pra dedup quando o webhook do
 *  ClickUp devolver o mesmo comentário. */
export async function addCommentToClickupTask({
  apiToken,
  taskId,
  comment,
}: {
  apiToken: string;
  taskId: string;
  comment: string;
}): Promise<string | null> {
  if (!taskId) return null;
  try {
    const res = await fetch(taskApiUrl(taskId, "/comment"), {
      method: "POST",
      headers: { Authorization: apiToken, "Content-Type": "application/json" },
      body: JSON.stringify({ comment_text: comment, notify_all: false }),
    });
    if (!res.ok) {
      console.error("[ClickUp] addComment failed", res.status, await res.text());
      return null;
    }
    const data = await res.json().catch(() => null);
    const id = data?.id ?? data?.hist_id ?? null;
    return id ? String(id) : null;
  } catch (err) {
    console.error("[ClickUp] addComment error", err);
    return null;
  }
}

/** Build a ClickUp task URL from a task ID or URL. */
export function clickupTaskUrl(taskId: string): string {
  if (!taskId) return "";
  if (taskId.startsWith("http")) return taskId;
  return `https://app.clickup.com/t/${taskId}`;
}

/**
 * Extrai o ID da tarefa e o teamId a partir de um valor que pode ser:
 * - ID puro:  "abc123"
 * - ID customizado com prefixo: "ADM-91036"
 * - URL completa: "https://app.clickup.com/t/36994692/ADM-91036"
 *
 * Retorna { taskId, teamId? } para montar a URL correta da API.
 * IDs customizados (com "-") precisam de ?custom_task_ids=true&team_id=
 */
function resolveTaskForApi(taskIdOrUrl: string): { taskId: string; teamId?: string } {
  if (!taskIdOrUrl) return { taskId: taskIdOrUrl };

  // URL completa: https://app.clickup.com/t/{teamId}/{customId}
  if (taskIdOrUrl.startsWith("http")) {
    const parts = taskIdOrUrl.replace(/\/$/, "").split("/");
    const taskId = parts[parts.length - 1];  // "ADM-91036"
    const teamId = parts[parts.length - 2];  // "36994692"
    return { taskId, teamId: /^\d+$/.test(teamId) ? teamId : undefined };
  }

  return { taskId: taskIdOrUrl };
}

/** Monta a URL base da API para uma task, resolvendo custom IDs e URLs. */
function taskApiUrl(taskIdOrUrl: string, suffix: string): string {
  const { taskId, teamId } = resolveTaskForApi(taskIdOrUrl);
  const qs = teamId ? `?custom_task_ids=true&team_id=${teamId}` : "";
  return `${BASE}/task/${taskId}${suffix}${qs}`;
}

// ── High-level helpers ────────────────────────────────────────────────────────

/**
 * Auto-sync a Ticket to ClickUp.
 * - If no `clickupTaskId`: creates a new task and returns the new task ID.
 * - If `clickupTaskId` exists: updates the task.
 */
export async function syncTicketToClickup({
  settings,
  ticketId,
  existingClickupTaskId,
  title,
  description,
  priority,
  status,
  targetListId,
}: {
  settings: ClickupSettings;
  ticketId: string;
  existingClickupTaskId?: string | null;
  title: string;
  description?: string;
  priority?: string;
  status?: string;
  // Lista de destino ao CRIAR. Default = lista padrão de chamados. Quando o
  // chamado é agrupado num projeto, passa o clickupListId do projeto.
  targetListId?: string;
}): Promise<string | null> {
  const mappedStatus = status ? mapTicketStatus(status, settings.statusChamadoConcluido) : undefined;

  if (existingClickupTaskId) {
    await updateClickupTask({
      apiToken: settings.apiToken,
      taskId: existingClickupTaskId,
      name: title,
      description,
      priority,
      status: mappedStatus,
    });
    return existingClickupTaskId;
  }

  const listId = targetListId?.trim() || settings.ticketsListId;
  if (!listId) return null;

  // Ao criar, NÃO passa status — usa o padrão da lista para evitar erro 400
  // (o status do ClickUp precisa existir com nome exato na lista)
  const newId = await createClickupTask({
    apiToken: settings.apiToken,
    listId,
    name: title,
    description,
    priority,
    tags: ["chamado"],
  });

  return newId;
}

/**
 * "Move" a task de chamado pra lista de um projeto. A API pública do ClickUp
 * não tem mover-de-lista nativo, então recriamos: cria uma task nova na lista
 * do projeto (com link pra task antiga no descritivo), comenta na antiga
 * apontando pra nova e fecha/arquiva a antiga.
 *
 * Retorna o ID da NOVA task (que deve substituir o clickupTaskId do chamado),
 * ou null se a criação falhar (nesse caso nada é mexido na task antiga).
 */
export async function recreateTicketTaskInList({
  settings,
  oldTaskId,
  listId,
  title,
  description,
  priority,
}: {
  settings: ClickupSettings;
  oldTaskId: string;
  listId: string;
  title: string;
  description?: string;
  priority?: string;
}): Promise<string | null> {
  if (!listId) return null;

  const oldUrl   = clickupTaskUrl(oldTaskId);
  const backlink = `↪ Movido de tarefa anterior (fechada): ${oldUrl}`;
  const desc     = description ? `${description}\n\n${backlink}` : backlink;

  const newId = await createClickupTask({
    apiToken: settings.apiToken,
    listId,
    name: title,
    description: desc,
    priority,
    tags: ["chamado"],
  });
  if (!newId) return null;

  // Aponta a antiga pra nova e fecha/arquiva. Best-effort — se falhar, a nova
  // já existe e o chamado já aponta pra ela; a antiga fica como órfã visível.
  await addCommentToClickupTask({
    apiToken: settings.apiToken,
    taskId: oldTaskId,
    comment: `➡️ Chamado movido para um projeto. Tarefa nova: ${clickupTaskUrl(newId)}`,
  }).catch(() => null);
  await updateClickupTask({
    apiToken: settings.apiToken,
    taskId: oldTaskId,
    status: settings.statusChamadoConcluido?.trim() || undefined,
    archived: true,
  }).catch(() => false);

  return newId;
}

/**
 * Auto-sync an Oportunidade (OPORTUNIDADES pipeline lead) to ClickUp.
 * - If no `clickupTaskId`: creates a new task.
 * - If exists: updates the task status/priority.
 */
export async function syncOportunidadeToClickup({
  settings,
  leadId,
  existingClickupTaskId,
  name,
  notes,
  value,
  pipelineStage,
  linkUrl,
  linkLabel,
  priority = "MEDIUM",
}: {
  settings: ClickupSettings;
  leadId: string;
  existingClickupTaskId?: string | null;
  name: string;
  notes?: string | null;
  value?: number | null;
  pipelineStage?: string | null;
  linkUrl?: string | null;   // URL de destino do link de rastreio (orçamento, proposta, etc.)
  linkLabel?: string | null; // Rótulo do link para exibição
  priority?: string;
}): Promise<string | null> {
  const linkLine = linkUrl
    ? `🔗 ${linkLabel ? `${linkLabel}: ` : ""}${linkUrl}`
    : null;

  const description = [
    notes,
    value != null ? `💰 Valor: R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : null,
    linkLine,
    `🔖 ID LeadHub: ${leadId}`,
  ].filter(Boolean).join("\n\n");

  if (existingClickupTaskId) {
    await updateClickupTask({
      apiToken: settings.apiToken,
      taskId: existingClickupTaskId,
      name,
      description,
      priority,
      status: pipelineStage ?? undefined,
    });
    return existingClickupTaskId;
  }

  if (!settings.oportunidadesListId) return null;

  // Ao criar, NÃO passa status — usa o padrão da lista para evitar erro 400
  const newId = await createClickupTask({
    apiToken: settings.apiToken,
    listId: settings.oportunidadesListId,
    name,
    description,
    priority,
    tags: ["oportunidade"],
  });

  return newId;
}

// ── Project sync ──────────────────────────────────────────────────────────────

/**
 * Busca estatísticas de uma lista do ClickUp: total de tarefas, concluídas e
 * vencidas. Usado pelo cron de sync de Projetos.
 *
 * Retorna null se a lista não for encontrada ou houver erro de auth.
 */
/** Tipo enxuto de tarefa do ClickUp usado nos syncs. */
export type ClickupTaskLite = {
  id:            string;
  name:          string;
  statusName:    string | null;
  isCompleted:   boolean;
  hasNoAssignee: boolean;
  dueDate:       number | null;     // epoch ms
  dateUpdated:   number | null;     // epoch ms
};

/**
 * Retorna a lista completa de tarefas de uma lista do ClickUp em formato
 * enxuto. Usado pelo sync que detecta criações/atualizações/conclusões.
 */
export async function fetchClickupTasks(
  apiToken: string,
  listId: string,
): Promise<ClickupTaskLite[] | null> {
  const url = `${BASE}/list/${listId}/task?include_closed=true&subtasks=true`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: apiToken },
      cache:   "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw: any[] = data.tasks ?? [];
    return raw.map((t) => ({
      id:            String(t.id),
      name:          String(t.name ?? ""),
      statusName:    t.status?.status ?? null,
      isCompleted:   t.status?.type === "closed" || t.status?.type === "done",
      hasNoAssignee: !Array.isArray(t.assignees) || t.assignees.length === 0,
      dueDate:       t.due_date     ? Number(t.due_date)     : null,
      dateUpdated:   t.date_updated ? Number(t.date_updated) : null,
    }));
  } catch {
    return null;
  }
}

export async function fetchClickupListStats(
  apiToken: string,
  listId: string,
): Promise<{
  taskCount: number;
  taskCompleted: number;
  taskOverdue: number;
  taskNoDueDate: number;
  taskNoAssignee: number;
} | null> {
  // include_closed=true porque por padrão a API exclui tarefas concluídas
  const url = `${BASE}/list/${listId}/task?include_closed=true&subtasks=true`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: apiToken },
      cache:   "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const tasks: any[] = data.tasks ?? [];

    const now = new Date();
    let taskCount      = 0;
    let taskCompleted  = 0;
    let taskOverdue    = 0;
    let taskNoDueDate  = 0;
    let taskNoAssignee = 0;

    for (const t of tasks) {
      taskCount++;
      const isDone = t.status?.type === "closed" || t.status?.type === "done";
      const noAssignee = !Array.isArray(t.assignees) || t.assignees.length === 0;
      if (isDone) {
        taskCompleted++;
      } else {
        const dueMs = t.due_date ? Number(t.due_date) : null;
        if (!dueMs) taskNoDueDate++;
        // Atrasada = passou o dia inteiro do prazo. Tarefa com prazo HOJE
        // não é atrasada — vence só quando vira amanhã.
        else if (isOverdueByDay(new Date(dueMs), now)) taskOverdue++;
        if (noAssignee) taskNoAssignee++;
      }
    }

    return { taskCount, taskCompleted, taskOverdue, taskNoDueDate, taskNoAssignee };
  } catch {
    return null;
  }
}
