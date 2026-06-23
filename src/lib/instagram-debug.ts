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
