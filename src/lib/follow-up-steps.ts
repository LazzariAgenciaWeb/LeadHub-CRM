/**
 * Validação das etapas do follow-up vindas da tela do agente
 * (Assistant.followUpSteps). Fica fora do auto-agent pra rota da API não
 * carregar o motor inteiro só pra validar um formulário.
 */
export type FollowUpStepInput = { delayMin: number; text: string };

export const FOLLOWUP_MIN_DELAY_MIN = 10; // "10 min (teste)"
export const FOLLOWUP_MAX_DELAY_MIN = 14 * 24 * 60; // 14 dias
export const FOLLOWUP_MAX_STEPS = 4;

/** Até 4 etapas, atraso entre 10 min e 14 dias, texto obrigatório; o resto é descartado. */
export function sanitizeFollowUpSteps(raw: unknown): FollowUpStepInput[] | null {
  if (!Array.isArray(raw)) return null;
  const steps = raw
    .map((x: any) => ({
      delayMin: Math.min(FOLLOWUP_MAX_DELAY_MIN, Math.max(FOLLOWUP_MIN_DELAY_MIN, parseInt(x?.delayMin, 10) || 0)),
      text: typeof x?.text === "string" ? x.text.trim() : "",
    }))
    .filter((x) => x.text)
    .slice(0, FOLLOWUP_MAX_STEPS);
  return steps.length ? steps : null;
}
