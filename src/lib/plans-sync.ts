/**
 * Sync entre PlanFeatures (catálogo) e Company.module* (gate efetivo no código).
 *
 * Razão de existir (Opção C que combinamos):
 *  - PlanFeatures é o catálogo comercial, define o que cada plano oferece.
 *  - Company.module* é o gate efetivo que o resto do código (Sidebar,
 *    hasModule(), gates de API) consulta. Sempre foi assim.
 *  - Trocar plano deve **propagar features → modules** com defaults, mas
 *    super admin pode customizar manualmente depois via toggles dos módulos
 *    no EditCompanyButton (sem ter que ir pro plano de novo).
 *
 * Mapeamento feature → moduleField (1:1 ou agregação):
 *  - whatsapp                      → moduleWhatsapp
 *  - crmPipeline* (qualquer um)    → moduleCrm
 *  - tickets                       → moduleTickets
 *  - assistenteIA                  → moduleAI
 *  - clickupSync                   → moduleClickup
 *  - gamificacao                   → moduleGamificacao
 *  - projetos                      → moduleProjetos
 *  - calendario                    → moduleCalendario
 *  - prospectaIa                   → moduleProspeccao
 *
 * O `modoAtendimento` do plano também propaga (FREE = VISAO, demais = ATENDE).
 */

import type { PlanFeatures } from "./plans";
import { PLANS, type PlanTier } from "./plans";

/** Fields da Company que recebem o sync. Tipado pra evitar typo. */
export interface CompanyModuleSync {
  moduleWhatsapp: boolean;
  moduleCrm: boolean;
  moduleTickets: boolean;
  moduleAI: boolean;
  moduleClickup: boolean;
  moduleGamificacao: boolean;
  moduleProjetos: boolean;
  moduleCalendario: boolean;
  moduleProspeccao: boolean;
  modoAtendimento: "VISAO" | "ATENDE";
}

/**
 * Converte um PlanFeatures (efetivo, com overrides aplicados) no shape de
 * `Company.module*`. CRM agrupa os 3 pipelines (basta 1 estar on).
 */
export function featuresToModules(
  features: PlanFeatures,
  modoAtendimento: "VISAO" | "ATENDE",
): CompanyModuleSync {
  return {
    moduleWhatsapp:    features.whatsapp,
    moduleCrm:         features.crmPipelineLeads || features.crmPipelineOportunidades || features.crmPipelineProspeccao,
    moduleTickets:     features.tickets,
    moduleAI:          features.assistenteIA,
    moduleClickup:     features.clickupSync,
    moduleGamificacao: features.gamificacao,
    moduleProjetos:    features.projetos,
    moduleCalendario:  features.calendario,
    moduleProspeccao:  features.prospectaIa,
    modoAtendimento,
  };
}

/**
 * Conveniência: dado um tier, retorna o sync que aplica os defaults do plano
 * (sem considerar customFeatures). Usado quando troca de plano e queremos
 * "resetar" os modules pros defaults novos.
 */
export function moduleSyncFromTier(tier: PlanTier): CompanyModuleSync {
  const plan = PLANS[tier];
  return featuresToModules(plan.features, plan.modoAtendimentoDefault);
}

/**
 * Calcula o diff entre módulos atuais e os defaults do plano novo.
 * Útil pra mostrar pro usuário "isso vai ligar X, desligar Y" antes de aplicar.
 */
export interface ModuleDiff {
  willEnable: (keyof CompanyModuleSync)[];
  willDisable: (keyof CompanyModuleSync)[];
  modoChange: { from: "VISAO" | "ATENDE"; to: "VISAO" | "ATENDE" } | null;
}

export function diffModuleSync(
  current: Partial<CompanyModuleSync>,
  next: CompanyModuleSync,
): ModuleDiff {
  const willEnable: (keyof CompanyModuleSync)[] = [];
  const willDisable: (keyof CompanyModuleSync)[] = [];

  const moduleKeys: (keyof CompanyModuleSync)[] = [
    "moduleWhatsapp", "moduleCrm", "moduleTickets", "moduleAI",
    "moduleClickup", "moduleGamificacao", "moduleProjetos",
    "moduleCalendario", "moduleProspeccao",
  ];

  for (const k of moduleKeys) {
    const cur = current[k] === true;
    const nxt = next[k] === true;
    if (cur && !nxt) willDisable.push(k);
    else if (!cur && nxt) willEnable.push(k);
  }

  const curModo = current.modoAtendimento ?? "ATENDE";
  const modoChange = curModo !== next.modoAtendimento
    ? { from: curModo, to: next.modoAtendimento }
    : null;

  return { willEnable, willDisable, modoChange };
}

/** Labels amigáveis pra UI mostrar o que ligou/desligou. */
export const MODULE_LABELS: Record<keyof CompanyModuleSync, string> = {
  moduleWhatsapp:    "WhatsApp",
  moduleCrm:         "CRM",
  moduleTickets:     "Tickets/Chamados",
  moduleAI:          "Assistente IA",
  moduleClickup:     "ClickUp Sync",
  moduleGamificacao: "Gamificação",
  moduleProjetos:    "Projetos",
  moduleCalendario:  "Calendário",
  moduleProspeccao:  "Prospecta IA",
  modoAtendimento:   "Modo de atendimento",
};
