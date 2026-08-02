import { prisma } from "./prisma";
import { ensureValidAccessToken } from "./google-calendar";
import { loadCompanyHours, SYSTEM_TIMEZONE, type CompanyHoursConfig } from "./business-hours";

/**
 * Agendamento direto no chat (agente autônomo).
 *
 * Fluxo: computeAvailableSlots() cruza a agenda Google do usuário vinculado ao
 * agente (freeBusy) com os HORÁRIOS DE ATENDIMENTO da empresa e devolve os
 * slots livres da próxima semana, separados manhã/tarde. O motor injeta isso
 * no prompt; quando o contato escolhe, bookMeeting() revalida o slot (nunca
 * confirma horário ocupado) e cria o evento com Google Meet.
 */

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const DAYS_AHEAD = 10; // janela de varredura (dias corridos)
const MIN_LEAD_MINUTES = 90; // antecedência mínima pra oferecer um slot
const SLOT_STEP_MIN = 30; // granularidade dos inícios de slot
// Regra de negócio (Diego 2026-08-02): NUNCA agendar pro mesmo dia, mesmo com
// horário livre — oferecer só os próximos N dias ÚTEIS (dias abertos no
// horário de atendimento da empresa) depois de hoje.
const BOOKING_SKIP_TODAY = true;
const BOOKING_MAX_BUSINESS_DAYS = 3;

export interface Slot {
  startISO: string; // ISO com offset — identificador exato do slot
  label: string; // "seg 04/08 09:00"
  period: "manha" | "tarde";
}

// ── Timezone helpers ──────────────────────────────────────────────────────────

function tzOffsetMs(tz: string, at: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUTC - at.getTime();
}

/** Data UTC correspondente a (ano, mês 1-12, dia, hh:mm) no fuso `tz`. */
function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = tzOffsetMs(tz, new Date(guess));
  return new Date(guess - offset);
}

function localDateParts(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    hour: "2-digit", minute: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24, minute: +p.minute,
    dayOfWeek: weekdayMap[p.weekday] ?? 0,
  };
}

const WEEKDAY_PT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function slotLabel(start: Date, tz: string): string {
  const p = localDateParts(start, tz);
  const dd = String(p.day).padStart(2, "0");
  const mo = String(p.month).padStart(2, "0");
  const hh = String(p.hour).padStart(2, "0");
  const mi = String(p.minute).padStart(2, "0");
  return `${WEEKDAY_PT[p.dayOfWeek]} ${dd}/${mo} ${hh}:${mi}`;
}

function toOffsetISO(d: Date, tz: string): string {
  const offMs = tzOffsetMs(tz, d);
  const sign = offMs <= 0 ? "-" : "+";
  const abs = Math.abs(offMs);
  const oh = String(Math.floor(abs / 3_600_000)).padStart(2, "0");
  const om = String(Math.floor((abs % 3_600_000) / 60_000)).padStart(2, "0");
  const local = new Date(d.getTime() + offMs);
  const iso = local.toISOString().slice(0, 19);
  return `${iso}${sign}${oh}:${om}`;
}

// ── Conexão do agente ─────────────────────────────────────────────────────────

/** Conexão Google Calendar ATIVA do usuário vinculado ao agente (ou null). */
export async function getAgentCalendarConnection(calendarUserId: string | null | undefined) {
  if (!calendarUserId) return null;
  const conn = await prisma.userGoogleConnection.findUnique({
    where: { userId_service: { userId: calendarUserId, service: "calendar" } },
    select: { id: true, status: true, googleEmail: true, scopes: true },
  });
  if (!conn || conn.status !== "ACTIVE") return null;
  return conn;
}

/** A conexão tem permissão de ESCRITA (criar evento)? Sem ela: só fallback link. */
export function connectionCanWrite(conn: { scopes: string[] }): boolean {
  return conn.scopes.some((s) => s.includes("auth/calendar.events") || s === "https://www.googleapis.com/auth/calendar");
}

// ── Disponibilidade ───────────────────────────────────────────────────────────

async function fetchBusy(connectionId: string, timeMin: Date, timeMax: Date): Promise<{ start: number; end: number }[]> {
  const accessToken = await ensureValidAccessToken(connectionId);
  const r = await fetch(`${CALENDAR_API}/freeBusy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: "primary" }],
    }),
  });
  if (!r.ok) throw new Error(`freeBusy: ${r.status} ${await r.text()}`);
  const data = await r.json();
  const busy: { start: string; end: string }[] = data?.calendars?.primary?.busy ?? [];
  return busy.map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
}

function overlapsBusy(startMs: number, endMs: number, busy: { start: number; end: number }[]): boolean {
  return busy.some((b) => startMs < b.end && endMs > b.start);
}

/**
 * Slots livres nos próximos DAYS_AHEAD dias: dentro dos horários de atendimento
 * da empresa (menos pausas), fora dos períodos ocupados da agenda, com
 * antecedência mínima. Ordenados no tempo.
 */
export async function computeAvailableSlots(args: {
  companyId: string;
  connectionId: string;
  durationMin: number;
  maxSlots?: number;
}): Promise<Slot[]> {
  const { companyId, connectionId, durationMin } = args;
  const maxSlots = args.maxSlots ?? 24;
  const tz = SYSTEM_TIMEZONE;
  const now = new Date();
  const windowEnd = new Date(now.getTime() + DAYS_AHEAD * 86_400_000);

  const [hours, busy] = await Promise.all([
    loadCompanyHours(companyId),
    fetchBusy(connectionId, now, windowEnd),
  ]);

  const minStartMs = now.getTime() + MIN_LEAD_MINUTES * 60_000;
  const slots: Slot[] = [];
  const today = localDateParts(now, tz);
  let businessDaysUsed = 0;

  for (let dayOffset = 0; dayOffset <= DAYS_AHEAD && slots.length < maxSlots; dayOffset++) {
    // Data local do dia-alvo: meia-noite local de hoje + offset em dias
    const dayRef = new Date(zonedToUtc(today.year, today.month, today.day, 12, 0, tz).getTime() + dayOffset * 86_400_000);
    const dp = localDateParts(dayRef, tz);
    const dayCfg = hours.find((h) => h.dayOfWeek === dp.dayOfWeek);
    if (!dayCfg?.isOpen) continue;

    // Nunca hoje; e só os próximos N dias úteis depois de hoje.
    if (BOOKING_SKIP_TODAY && dayOffset === 0) continue;
    businessDaysUsed++;
    if (businessDaysUsed > BOOKING_MAX_BUSINESS_DAYS) break;

    const [openH, openM] = dayCfg.openTime.split(":").map(Number);
    const [closeH, closeM] = dayCfg.closeTime.split(":").map(Number);
    const dayOpen = zonedToUtc(dp.year, dp.month, dp.day, openH, openM, tz).getTime();
    const dayClose = zonedToUtc(dp.year, dp.month, dp.day, closeH, closeM, tz).getTime();

    const pauses = dayCfg.intervals.map((iv) => {
      const [sh, sm] = iv.startTime.split(":").map(Number);
      const [eh, em] = iv.endTime.split(":").map(Number);
      return {
        start: zonedToUtc(dp.year, dp.month, dp.day, sh, sm, tz).getTime(),
        end: zonedToUtc(dp.year, dp.month, dp.day, eh, em, tz).getTime(),
      };
    });

    for (let startMs = dayOpen; startMs + durationMin * 60_000 <= dayClose; startMs += SLOT_STEP_MIN * 60_000) {
      const endMs = startMs + durationMin * 60_000;
      if (startMs < minStartMs) continue;
      if (overlapsBusy(startMs, endMs, pauses)) continue;
      if (overlapsBusy(startMs, endMs, busy)) continue;

      const start = new Date(startMs);
      const lp = localDateParts(start, tz);
      slots.push({
        startISO: toOffsetISO(start, tz),
        label: slotLabel(start, tz),
        period: lp.hour < 12 ? "manha" : "tarde",
      });
      if (slots.length >= maxSlots) break;
    }
  }

  return slots;
}

/** Revalida um slot específico (nunca confirmar horário ocupado). */
export async function isSlotStillFree(connectionId: string, startISO: string, durationMin: number): Promise<boolean> {
  const startMs = Date.parse(startISO);
  if (Number.isNaN(startMs)) return false;
  const endMs = startMs + durationMin * 60_000;
  const busy = await fetchBusy(connectionId, new Date(startMs - 60_000), new Date(endMs + 60_000));
  return !overlapsBusy(startMs, endMs, busy);
}

// ── Criação do evento ─────────────────────────────────────────────────────────

export interface BookedMeeting {
  eventId: string;
  meetLink: string | null;
  htmlLink: string | null;
  start: Date;
  label: string;
}

/** Cria o evento no calendário primário com Google Meet + convite por e-mail. */
export async function createMeetEvent(args: {
  connectionId: string;
  startISO: string;
  durationMin: number;
  summary: string;
  description?: string;
  attendeeEmail?: string | null;
}): Promise<BookedMeeting> {
  const { connectionId, startISO, durationMin, summary, description, attendeeEmail } = args;
  const accessToken = await ensureValidAccessToken(connectionId);

  const start = new Date(Date.parse(startISO));
  const end = new Date(start.getTime() + durationMin * 60_000);

  const body: any = {
    summary,
    description: description ?? undefined,
    start: { dateTime: start.toISOString(), timeZone: SYSTEM_TIMEZONE },
    end: { dateTime: end.toISOString(), timeZone: SYSTEM_TIMEZONE },
    conferenceData: {
      createRequest: {
        requestId: `leadhub-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
    ...(attendeeEmail ? { attendees: [{ email: attendeeEmail }] } : {}),
  };

  const params = new URLSearchParams({ conferenceDataVersion: "1", sendUpdates: "all" });
  const r = await fetch(`${CALENDAR_API}/calendars/primary/events?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`events.insert: ${r.status} ${await r.text()}`);
  const ev = await r.json();

  const meetLink: string | null =
    ev?.hangoutLink ??
    ev?.conferenceData?.entryPoints?.find((e: any) => e?.entryPointType === "video")?.uri ??
    null;

  return {
    eventId: ev.id,
    meetLink,
    htmlLink: ev.htmlLink ?? null,
    start,
    label: slotLabel(start, SYSTEM_TIMEZONE),
  };
}

/** "sáb, 02/08 16:32" — contexto de data/hora atual pro prompt. */
export function nowLabel(): string {
  return slotLabel(new Date(), SYSTEM_TIMEZONE);
}
