import { prisma } from "@/lib/prisma";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClickupSettings {
  apiToken: string;
  oportunidadesListId: string;
  ticketsListId: string;
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

// Ticket status → ClickUp status name (ClickUp statuses must exist on the list)
const TICKET_STATUS_MAP: Record<string, string> = {
  OPEN:        "to do",
  IN_PROGRESS: "in progress",
  RESOLVED:    "complete",
  CLOSED:      "closed",
};

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
  ];
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  const apiToken            = map[`clickup_api_token:${companyId}`]?.trim()            ?? "";
  const oportunidadesListId = map[`clickup_oportunidades_list_id:${companyId}`]?.trim() ?? "";
  const ticketsListId       = map[`clickup_tickets_list_id:${companyId}`]?.trim()      ?? "";

  if (!apiToken) return null;
  return { apiToken, oportunidadesListId, ticketsListId };
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
  tags = [],
}: {
  apiToken: string;
  listId: string;
  name: string;
  description?: string;
  priority?: string;   // "URGENT" | "HIGH" | "MEDIUM" | "LOW"
  status?: string;     // ClickUp status name on the target list
  tags?: string[];
}): Promise<string | null> {
  if (!listId) return null;
  try {
    const body: Record<string, unknown> = { name };
    if (description)               body.description  = description;
    if (priority && PRIORITY_MAP[priority]) body.priority = PRIORITY_MAP[priority];
    if (status)                    body.status       = status;
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
}: {
  apiToken: string;
  taskId: string;
  name?: string;
  description?: string;
  priority?: string;
  status?: string;
}): Promise<boolean> {
  if (!taskId) return false;
  try {
    const body: Record<string, unknown> = {};
    if (name)        body.name        = name;
    if (description) body.description = description;
    if (priority && PRIORITY_MAP[priority]) body.priority = PRIORITY_MAP[priority];
    if (status)      body.status      = status;

    const res = await fetch(`${BASE}/task/${taskId}`, {
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
    const res = await fetch(`${BASE}/task/${taskId}/comment`, {
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
}: {
  settings: ClickupSettings;
  ticketId: string;
  existingClickupTaskId?: string | null;
  title: string;
  description?: string;
  priority?: string;
  status?: string;
}): Promise<string | null> {
  const mappedStatus = status ? (TICKET_STATUS_MAP[status] ?? status) : undefined;

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

  if (!settings.ticketsListId) return null;

  // Ao criar, NÃO passa status — usa o padrão da lista para evitar erro 400
  // (o status do ClickUp precisa existir com nome exato na lista)
  const newId = await createClickupTask({
    apiToken: settings.apiToken,
    listId: settings.ticketsListId,
    name: title,
    description,
    priority,
    tags: ["chamado"],
  });

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
  priority = "MEDIUM",
}: {
  settings: ClickupSettings;
  leadId: string;
  existingClickupTaskId?: string | null;
  name: string;
  notes?: string | null;
  value?: number | null;
  pipelineStage?: string | null;
  priority?: string;
}): Promise<string | null> {
  const description = [
    notes,
    value != null ? `Valor: R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : null,
    `ID LeadHub: ${leadId}`,
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

    const now = Date.now();
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
        const due = t.due_date ? Number(t.due_date) : null;
        if (!due) taskNoDueDate++;
        else if (due < now) taskOverdue++;
        if (noAssignee) taskNoAssignee++;
      }
    }

    return { taskCount, taskCompleted, taskOverdue, taskNoDueDate, taskNoAssignee };
  } catch {
    return null;
  }
}
