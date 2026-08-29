/**
 * Regras de competência do Financeiro.
 *
 * Tudo aqui é derivado — não existe "marquei que faturei". A pergunta
 * "esse cliente já foi cobrado este mês?" é respondida por uma diferença de
 * conjuntos: contratos recorrentes ativos que deveriam vencer na competência
 * MENOS os que já têm ClientInvoice naquela competência. É de propósito: uma
 * lista marcada à mão (a de hoje, no ClickUp) desatualiza em silêncio; uma
 * derivada não tem como mentir.
 */

export type Cycle = "MENSAL" | "TRIMESTRAL" | "ANUAL";

export const CYCLE_MONTHS: Record<Cycle, number> = {
  MENSAL: 1,
  TRIMESTRAL: 3,
  ANUAL: 12,
};

export const CYCLE_LABEL: Record<Cycle, string> = {
  MENSAL: "Mensal",
  TRIMESTRAL: "Trimestral",
  ANUAL: "Anual",
};

/** "YYYY-MM" da data informada (fuso local). */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Intervalo [início, fim) da competência "YYYY-MM". */
export function monthRange(key: string): { from: Date; to: Date } {
  const [y, m] = key.split("-").map(Number);
  return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1) };
}

/** Competência deslocada em N meses (N negativo = passado). */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

export function monthLabel(key: string): string {
  const { from } = monthRange(key);
  const s = from.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Distância em meses entre duas competências (b - a). */
function monthDistance(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

export interface RecurringLike {
  isRecurring: boolean;
  status: string;
  amountCents: number | null;
  billingCycle: string | null;
  renewsAt: Date | null;
}

/**
 * O contrato vence nesta competência?
 *
 * MENSAL (ou ciclo em branco, que é o caso legado) vence todo mês. Trimestral
 * e anual precisam de âncora: usam `renewsAt` e caem só nos múltiplos do ciclo
 * a partir dele. Sem âncora, um contrato anual apareceria na fila de cobrança
 * TODO mês — o oposto de útil.
 */
export function dueInMonth(svc: RecurringLike, month: string): boolean {
  if (!svc.isRecurring) return false;
  if (svc.status !== "ATIVO") return false;
  if (!svc.amountCents) return false;

  const cycle = (svc.billingCycle as Cycle | null) ?? "MENSAL";
  const step = CYCLE_MONTHS[cycle] ?? 1;
  if (step === 1) return true;

  if (!svc.renewsAt) return false;
  const dist = monthDistance(monthKey(svc.renewsAt), month);
  // dist < 0 = competência ANTES da renovação registrada. `renewsAt` no futuro
  // significa "já faturei até lá" — contrato anual renovando em ago/2027 não
  // pode cair na fila de ago/2026, senão a anuidade é cobrada duas vezes.
  // Do mês da renovação em diante, cai nos múltiplos do ciclo normalmente.
  return dist >= 0 && dist % step === 0;
}

/**
 * Valor mensal equivalente do contrato — o contrato anual de R$ 12.000 vale
 * R$ 1.000/mês na leitura de MRR. Serve pra dimensionar a carteira, NÃO pra
 * prever o caixa do mês (pra isso existe dueInMonth).
 */
export function monthlyEquivalentCents(svc: RecurringLike): number {
  if (!svc.isRecurring || !svc.amountCents || svc.status !== "ATIVO") return 0;
  const cycle = (svc.billingCycle as Cycle | null) ?? "MENSAL";
  return Math.round(svc.amountCents / (CYCLE_MONTHS[cycle] ?? 1));
}

export const brlFromCents = (c: number) =>
  (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
