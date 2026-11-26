/**
 * Confirmação do chamado pelo cliente — parte PURA (vale na tela e no servidor).
 *
 * Fluxo: a equipe marca "Resolvido" → o chamado espera o cliente confirmar
 * pelo link de acompanhamento até CONFIRM_BUSINESS_DAYS dias úteis. Confirmou
 * → "Fechado" com o nome dele; não respondeu → o cron fecha sozinho. Escrever
 * pelo link reabre, como sempre.
 */

export const CONFIRM_BUSINESS_DAYS = 3;

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Dia da semana (0=dom) no fuso dado. */
export function weekdayIn(d: Date, timeZone: string): number {
  return WEEKDAY[new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(d)] ?? d.getDay();
}

/**
 * `from` + n dias úteis, no mesmo horário. Dia útil = dia aberto no horário de
 * atendimento da empresa (0=dom … 6=sáb). Resolvido na sexta às 17h, com 3
 * dias úteis → quarta às 17h. Feriado não entra na conta.
 */
export function addBusinessDays(from: Date, n: number, openDays: number[], timeZone: string): Date {
  const open = new Set(openDays);
  if (!open.size) return new Date(from.getTime() + n * 86_400_000);
  let d = new Date(from);
  let left = n;
  for (let guard = 0; left > 0 && guard < 60; guard++) {
    d = new Date(d.getTime() + 86_400_000);
    if (open.has(weekdayIn(d, timeZone))) left--;
  }
  return d;
}

export type ConfirmFields = {
  status: string;
  confirmDueAt: Date | string | null;
  confirmedAt: Date | string | null;
  confirmedByName: string | null;
  autoClosedAt: Date | string | null;
};

/**
 * Situação da confirmação pra mostrar na tela:
 *   waiting   — resolvido, esperando o cliente (até `due`)
 *   confirmed — o cliente confirmou (`by`)
 *   auto      — fechou sozinho, sem resposta do cliente
 *   null      — não se aplica (aberto, ou fechado direto pela equipe)
 */
export function confirmState(t: ConfirmFields):
  | { kind: "waiting"; due: Date }
  | { kind: "confirmed"; by: string; at: Date }
  | { kind: "auto"; at: Date }
  | null {
  if (t.status === "RESOLVED" && t.confirmDueAt) return { kind: "waiting", due: new Date(t.confirmDueAt) };
  if (t.status === "CLOSED" && t.confirmedAt) return { kind: "confirmed", by: t.confirmedByName ?? "Cliente", at: new Date(t.confirmedAt) };
  if (t.status === "CLOSED" && t.autoClosedAt) return { kind: "auto", at: new Date(t.autoClosedAt) };
  return null;
}

/** "hoje", "amanhã", "em 3 dias" — quanto falta pro chamado fechar sozinho. */
export function untilText(due: Date, now: Date = new Date()): string {
  const days = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
  if (days <= 0) return "hoje";
  if (days === 1) return "amanhã";
  return `em ${days} dias`;
}

/** Link de avaliação aceito: só https (é o que o Google entrega). */
export function cleanReviewUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
