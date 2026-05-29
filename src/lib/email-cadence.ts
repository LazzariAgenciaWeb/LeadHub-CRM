/**
 * Cadência de envio — controla quando o worker pode mandar mais emails
 * de uma campanha. Anti-banimento + respeito ao horário comercial.
 *
 * Config esperada:
 *   {
 *     maxPerHour: 60,
 *     jitterMs: [800, 4000],
 *     windowStart: "09:00",
 *     windowEnd: "18:00",
 *     daysOfWeek: [1,2,3,4,5],   // 0=domingo, 6=sábado
 *     timezone: "America/Sao_Paulo",
 *   }
 *
 * Pra MVP, a janela de horário e dia da semana ficam ancorados no TZ
 * passado (via Intl.DateTimeFormat). Quota/hora é checada por contagem
 * direta no banco (EmailRecipient sentAt na última hora).
 */

export interface CadenceConfig {
  maxPerHour: number;
  jitterMs: [number, number];
  windowStart: string; // "HH:MM"
  windowEnd: string;
  daysOfWeek: number[];
  timezone: string;
}

export const DEFAULT_CADENCE: CadenceConfig = {
  maxPerHour: 60,
  jitterMs: [800, 4000],
  windowStart: "09:00",
  windowEnd: "18:00",
  daysOfWeek: [1, 2, 3, 4, 5],
  timezone: "America/Sao_Paulo",
};

function timeInTZ(now: Date, timezone: string): { hour: number; minute: number; dayOfWeek: number } {
  // Intl formata pra TZ certo; pegamos hour/minute/weekday
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric", minute: "numeric", weekday: "short", hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hour: parseInt(map.hour ?? "0", 10),
    minute: parseInt(map.minute ?? "0", 10),
    dayOfWeek: weekdayMap[map.weekday ?? "Sun"] ?? 0,
  };
}

function parseHHMM(s: string): { h: number; m: number } {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  return { h: h || 0, m: m || 0 };
}

/**
 * Retorna razão de bloqueio (string) ou null se está dentro da janela.
 * `sentLastHour` deve ser passado por quem chama (contagem do banco).
 */
export function checkCadence(
  cfg: CadenceConfig,
  now: Date,
  sentLastHour: number
): { ok: true } | { ok: false; reason: string } {
  const tz = cfg.timezone || DEFAULT_CADENCE.timezone;
  const { hour, minute, dayOfWeek } = timeInTZ(now, tz);

  if (!cfg.daysOfWeek.includes(dayOfWeek)) {
    return { ok: false, reason: `fora dos dias permitidos (hoje=${dayOfWeek})` };
  }

  const start = parseHHMM(cfg.windowStart);
  const end = parseHHMM(cfg.windowEnd);
  const minutesNow = hour * 60 + minute;
  const startMin = start.h * 60 + start.m;
  const endMin = end.h * 60 + end.m;

  if (minutesNow < startMin) return { ok: false, reason: `antes do início (${cfg.windowStart})` };
  if (minutesNow >= endMin)  return { ok: false, reason: `depois do fim (${cfg.windowEnd})` };

  if (sentLastHour >= cfg.maxPerHour) {
    return { ok: false, reason: `quota da última hora atingida (${sentLastHour}/${cfg.maxPerHour})` };
  }

  return { ok: true };
}

/** Sleep aleatório dentro da janela jitterMs. */
export function jitterDelayMs(cfg: CadenceConfig): number {
  const [min, max] = cfg.jitterMs ?? [500, 2000];
  return Math.floor(min + Math.random() * Math.max(0, max - min));
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
