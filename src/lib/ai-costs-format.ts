/**
 * Tipos e formatação do consumo de IA — SEM prisma, pra poder entrar em
 * client components (o cálculo em si fica em ai-costs.ts, server-only).
 */
export interface AiSpendRow { model: string; calls: number; tokensIn: number; tokensOut: number; costUSD: number | null }
export interface AiSpend {
  todayUSD: number; weekUSD: number; monthUSD: number;
  todayCalls: number; monthCalls: number;
  byModelMonth: AiSpendRow[];
  /** modelos sem preço na tabela (gasto não estimado) */
  unpriced: string[];
  generatedAt: string;
}

export function fmtUSD(v: number): string {
  return `US$ ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: v < 0.1 ? 4 : 2 })}`;
}
