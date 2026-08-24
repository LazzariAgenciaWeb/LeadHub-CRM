/**
 * Normalização de valor e recorrência do contrato (ClientService).
 *
 * Vive fora das rotas porque POST e PATCH precisam da MESMA regra, e um
 * `route.ts` do App Router não deve exportar nada além dos handlers e da
 * config do segmento — exportar helper dali arrisca quebrar a validação de
 * tipos de rota no build.
 */

const CICLOS = ["MENSAL", "TRIMESTRAL", "ANUAL"];

export interface CobrancaNormalizada {
  amountCents: number | null;
  isRecurring: boolean;
  billingCycle: string | null;
  billingDay: number | null;
}

/**
 * Sem estes campos, contrato criado à mão nasce invisível: não entra na
 * previsão do mês nem na fila "a faturar", que só enxergam recorrente com
 * valor.
 */
export function cleanCobranca(body: unknown): CobrancaNormalizada {
  const b = (body ?? {}) as Record<string, unknown>;

  const cents = Math.round(Number(b.amountCents));
  const amountCents = Number.isFinite(cents) && cents >= 0 ? cents : null;

  const isRecurring = b.isRecurring === true;
  const dia = Math.round(Number(b.billingDay));
  const ciclo = typeof b.billingCycle === "string" ? b.billingCycle : "";

  return {
    amountCents,
    isRecurring,
    // Ciclo e dia só fazem sentido no recorrente; guardá-los num contrato
    // pontual deixaria lixo que a fila de cobrança leria como se valesse.
    billingCycle: isRecurring ? (CICLOS.includes(ciclo) ? ciclo : "MENSAL") : null,
    billingDay: isRecurring && Number.isFinite(dia) && dia >= 1 && dia <= 31 ? dia : null,
  };
}
