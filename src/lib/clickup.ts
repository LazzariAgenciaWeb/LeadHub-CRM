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

/** Load ClickUp API token and list IDs from the Settings table. Returns null if not configured. */
export async function getClickupSettings(): Promise<ClickupSettings | null> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ["clickup_api_token", "clickup_oportunidades_list_id", "clickup_tickets_list_id"] } },
  });
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  const apiToken          = map["clickup_api_token"]?.trim() ?? "";
  const oportunidadesListId = map["clickup_oportunidades_list_id"]?.trim() ?? "";
  const ticketsListId     = map["clickup_tickets_list_id"]?.trim() ?? "";

  if (!apiToken) return null;
  return { apiToken, oportunidadesListId, ticketsListId };
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

/** Add a comment to a ClickUp task. */
export async function addCommentToClickupTask({
  apiToken,
  taskId,
  comment,
}: {
  apiToken: string;
  taskId: string;
  comment: string;
}): Promise<boolean> {
  if (!taskId) return false;
  try {
    const res = await fetch(`${BASE}/task/${taskId}/comment`, {
      method: "POST",
      headers: { Authorization: apiToken, "Content-Type": "application/json" },
      body: JSON.stringify({ comment_text: comment, notify_all: false }),
    });
    if (!res.ok) {
      console.error("[ClickUp] addComment failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[ClickUp] addComment error", err);
    return false;
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
