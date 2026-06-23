/**
 * instagram-debug.ts — buffer em memória dos últimos callbacks de OAuth do
 * Instagram, pra diagnosticar falhas silenciosas sem caçar log no Portainer.
 *
 * Single-instance (app roda como 1 processo node server.js) — mesmo padrão do
 * recentEvents do webhook. Reseta a cada deploy. Não guarda segredo (token nunca
 * entra aqui).
 */

export interface IgCallbackTrace {
  ts: string;
  companyId: string | null;
  step: string; // último passo alcançado / onde falhou
  ok: boolean;
  detail?: string; // mensagem de erro resumida (sem segredo)
}

const recent: IgCallbackTrace[] = [];

export function recordIgCallback(entry: Omit<IgCallbackTrace, "ts">): void {
  recent.unshift({ ts: new Date().toISOString(), ...entry });
  if (recent.length > 20) recent.pop();
}

export function getRecentIgCallbacks(): IgCallbackTrace[] {
  return recent;
}

// ─── Eventos do webhook (comentários / DMs recebidos) ─────────────────────────

export interface IgWebhookTrace {
  ts: string;
  type: string; // "comment" | "message" | "no_account" | "other"
  accountIgUserId: string;
  companyId?: string | null;
  from?: string | null; // igsid de quem comentou/mandou DM
  username?: string | null;
  text?: string | null;
  mediaId?: string | null;
  note?: string | null;
}

const recentWebhook: IgWebhookTrace[] = [];

export function recordIgWebhookEvent(entry: Omit<IgWebhookTrace, "ts">): void {
  recentWebhook.unshift({ ts: new Date().toISOString(), ...entry });
  if (recentWebhook.length > 30) recentWebhook.pop();
}

export function getRecentIgWebhookEvents(): IgWebhookTrace[] {
  return recentWebhook;
}
