/**
 * Plano anual pago por Pix.
 *
 * A Stripe não oferece Pix recorrente para empresa no Brasil, então o anual no
 * Pix é um pagamento único de 12 meses: não existe assinatura na Stripe, quem
 * controla a validade é o nosso `currentPeriodEnd`. A renovação é manual, com
 * lembrete por e-mail (cron/billing).
 *
 * Aqui só ficam as regras puras — ver scripts/test-pix-annual.ts.
 */
import { PAGE_LINE_PAID, PLANS, PLAN_ORDER, type PlanTier } from "./plans";

/** metadata.kind da sessão de Checkout. */
export const PIX_ANNUAL_KIND = "pix_annual";
/** Gravado em Subscription.stripePriceId: marca que o período é controlado por nós. */
export const PIX_ANNUAL_PRICE_ID = "pix_annual";
/** Dias de tolerância depois do vencimento antes de tirar o plano. */
export const PIX_GRACE_DAYS = 3;
/** Faltando quantos dias o cliente recebe aviso de renovação. */
export const PIX_REMINDER_DAYS = [30, 7, 1];

const DAY_MS = 24 * 60 * 60 * 1000;

export function isPixAnnualTier(tier: unknown): tier is PlanTier {
  if (typeof tier !== "string" || tier === "FREE" || !(tier in PLANS)) return false;
  const t = tier as PlanTier;
  return (PLAN_ORDER.includes(t) || PAGE_LINE_PAID.includes(t)) && PLANS[t].priceAnnualTotal > 0;
}

/** Total do ano em centavos, sem erro de ponto flutuante. */
export function pixAnnualCents(tier: PlanTier): number {
  return Math.round(PLANS[tier].priceAnnualTotal * 100);
}

function plusOneYear(d: Date): Date {
  const out = new Date(d);
  out.setUTCFullYear(out.getUTCFullYear() + 1);
  return out;
}

/** Renovou o mesmo plano antes de vencer? Os 12 meses somam no fim do período atual. */
export function pixAnnualPeriod(
  now: Date,
  current?: { sameTier: boolean; end: Date | null } | null,
): { start: Date; end: Date } {
  const start = current?.sameTier && current.end && current.end > now ? current.end : now;
  return { start, end: plusOneYear(start) };
}

export type PixAnnualAction =
  | { type: "none" }
  | { type: "remind"; days: number }
  | { type: "expire" };

/** O que o cron faz com uma assinatura anual no Pix hoje. `sent` = avisos já enviados neste período. */
export function pixAnnualAction(end: Date, now: Date, sent: number[]): PixAnnualAction {
  if (now.getTime() >= end.getTime() + PIX_GRACE_DAYS * DAY_MS) return { type: "expire" };
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / DAY_MS);
  if (daysLeft <= 0) return { type: "none" };
  // Só a menor faixa que contém a data: quem entra atrasado não recebe os avisos antigos.
  const bracket = [...PIX_REMINDER_DAYS].sort((a, b) => a - b).find((d) => daysLeft <= d);
  if (bracket === undefined || sent.includes(bracket)) return { type: "none" };
  return { type: "remind", days: bracket };
}
