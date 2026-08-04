/**
 * Módulo Ponto — tipos e rótulos PUROS, sem nenhum import do Prisma.
 * Importável tanto por server components/rotas quanto por client components
 * (o client não pode puxar "@/generated/prisma" pro bundle do browser).
 * Os union types espelham os enums do schema — se mudar lá, mude aqui.
 */

export type PunchTypeStr = "ENTRADA" | "INTERVALO_INICIO" | "INTERVALO_FIM" | "SAIDA";
export type PunchSourceStr = "MANUAL" | "AJUSTE";
export type TimeOffTypeStr = "ATESTADO" | "FERIAS" | "FERIADO" | "FOLGA";
export type PunchAdjustStatusStr = "PENDENTE" | "APROVADO" | "REJEITADO";

export const PUNCH_TYPES: PunchTypeStr[] = ["ENTRADA", "INTERVALO_INICIO", "INTERVALO_FIM", "SAIDA"];

export const PUNCH_LABEL: Record<PunchTypeStr, string> = {
  ENTRADA:          "Entrada",
  INTERVALO_INICIO: "Início do intervalo",
  INTERVALO_FIM:    "Fim do intervalo",
  SAIDA:            "Saída",
};

export const TIMEOFF_LABEL: Record<TimeOffTypeStr, string> = {
  ATESTADO: "Atestado",
  FERIAS:   "Férias",
  FERIADO:  "Feriado",
  FOLGA:    "Folga",
};

export const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function monthLabel(year: number, month: number): string {
  const names = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  return `${names[month - 1]} de ${year}`;
}

/** "8h30" a partir de minutos (negativo vira "-1h15"). */
export function formatMin(min: number): string {
  const sign = min < 0 ? "-" : "";
  const abs = Math.abs(Math.round(min));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h${String(m).padStart(2, "0")}`;
}

// ─── Espelho (DTO serializável — o que as páginas passam pros clients) ───────

export type EspelhoDayStatus =
  | "OK" | "HOJE" | "INCOMPLETO" | "FALTA" | "ABONO" | "SEM_JORNADA" | "FUTURO";

export const STATUS_LABEL: Record<EspelhoDayStatus, string> = {
  OK:          "Completo",
  HOJE:        "Hoje",
  INCOMPLETO:  "Incompleto",
  FALTA:       "Falta",
  ABONO:       "Abono",
  SEM_JORNADA: "Sem expediente",
  FUTURO:      "—",
};

export type EspelhoDay = {
  key: string;
  weekday: number;
  punches: { type: PunchTypeStr; time: string; source: PunchSourceStr }[];
  timeOff: TimeOffTypeStr | null;
  timeOffDesc: string | null;
  scheduled: boolean;
  expectedStart: string | null;
  expectedEnd: string | null;
  expectedMin: number;
  workedMin: number;
  status: EspelhoDayStatus;
};

export type Espelho = {
  year: number;
  month: number;
  days: EspelhoDay[];
  totals: {
    workedMin: number;
    expectedMin: number;
    balanceMin: number;
    faltas: number;
    abonos: number;
    diasTrabalhados: number;
  };
};

/**
 * Próxima batida válida — versão client (mesma regra do servidor, que
 * revalida de qualquer jeito no POST /api/ponto/punch).
 */
export function allowedNextPunchesStr(punches: { type: PunchTypeStr }[]): PunchTypeStr[] {
  const last = punches[punches.length - 1]?.type;
  if (!last) return ["ENTRADA"];
  switch (last) {
    case "ENTRADA":          return ["INTERVALO_INICIO", "SAIDA"];
    case "INTERVALO_INICIO": return ["INTERVALO_FIM"];
    case "INTERVALO_FIM":    return ["INTERVALO_INICIO", "SAIDA"];
    case "SAIDA":            return ["ENTRADA"];
  }
}
