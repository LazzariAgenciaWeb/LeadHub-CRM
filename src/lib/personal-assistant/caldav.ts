import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { appUrl } from "@/lib/assistant-tools/types";

/**
 * Lembretes do iPhone ⇄ bloquinho, via CalDAV (VTODO).
 *
 * O GoHub expõe UMA lista ("GoHub") com as tarefas e lembretes do usuário.
 * O iPhone adiciona como conta CalDAV (Ajustes → Calendário → Contas) e
 * sincroniza sozinho nos dois sentidos: concluir/editar/criar/apagar lá
 * reflete aqui e vice-versa. Rota em src/pages/api/caldav (Pages Router
 * porque o CalDAV usa PROPFIND/REPORT, que o App Router não aceita).
 */

export const CALDAV_BASE = "/api/caldav";
export const COLLECTION = `${CALDAV_BASE}/cal/gohub`;
const TZ_OFFSET = "-03:00"; // America/Sao_Paulo (sem horário de verão desde 2019)
const DONE_WINDOW_DAYS = 30; // concluídos recentes continuam na lista (marcados) pra sincronizar a baixa

/* ── autenticação (Basic: usuário = e-mail, senha = senha do iPhone) ─────── */

export function hashSecret(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function authenticateCaldav(authorization: string | undefined): Promise<{ userId: string; email: string; companyId: string | null } | null> {
  const m = (authorization ?? "").match(/^Basic\s+(.+)$/i);
  if (!m) return null;
  const decoded = Buffer.from(m[1], "base64").toString("utf8");
  const pass = decoded.slice(decoded.indexOf(":") + 1).trim();
  if (!pass) return null;
  const user = await prisma.user.findUnique({ where: { caldavPasswordHash: hashSecret(pass) }, select: { id: true, email: true, companyId: true } });
  return user ? { userId: user.id, email: user.email, companyId: user.companyId } : null;
}

/* ── quais itens vão pro iPhone ──────────────────────────────────────────── */

/** Tarefas e lembretes (não avisos), abertos ou concluídos há pouco; + tudo que nasceu no iPhone. */
export function syncedWhere(userId: string) {
  const since = new Date(Date.now() - DONE_WINDOW_DAYS * 86400_000);
  return {
    userId,
    archivedAt: null,
    AND: [
      { OR: [{ caldavUid: { not: null } }, { kind: { in: ["TASK", "REMINDER"] }, NOT: { tags: { has: "aviso" } } }] },
      { OR: [{ done: false }, { doneAt: { gte: since } }] },
    ],
  };
}

export const NOTE_SELECT = { id: true, title: true, body: true, dueAt: true, done: true, doneAt: true, tags: true, important: true, urgent: true, updatedAt: true, createdAt: true, caldavUid: true, caldavIcs: true, caldavIcsAt: true } as const;
export type SyncNote = { id: string; title: string; body: string | null; dueAt: Date | null; done: boolean; doneAt: Date | null; tags: string[]; important: boolean; urgent: boolean; updatedAt: Date; createdAt: Date; caldavUid: string | null; caldavIcs: string | null; caldavIcsAt: Date | null };

export const resourceName = (n: { id: string; caldavUid: string | null }) => n.caldavUid ?? n.id;
export const hrefOf = (n: { id: string; caldavUid: string | null }) => `${COLLECTION}/${encodeURIComponent(resourceName(n))}.ics`;
export const etagOf = (n: { updatedAt: Date }) => `"2-${n.updatedAt.getTime().toString(36)}"`;

/**
 * Estado da lista: CTag (muda quando qualquer item muda, entra ou sai) e
 * sync-token (RFC 6578) — o app Lembretes do iOS 27 só baixa os itens via
 * REPORT sync-collection. O token carrega o instante da última mudança.
 */
export async function collectionState(userId: string): Promise<{ ctag: string; syncToken: string }> {
  const [agg, count] = await Promise.all([
    prisma.assistantNote.aggregate({ where: { userId }, _max: { updatedAt: true } }),
    prisma.assistantNote.count({ where: syncedWhere(userId) }),
  ]);
  const ms = agg._max.updatedAt?.getTime() ?? 0;
  return { ctag: `"2-${count}-${ms.toString(36)}"`, syncToken: `${SYNC_TOKEN_PREFIX}${ms}-${count}` };
}
export const SYNC_TOKEN_PREFIX = "http://gohub.app/ns/sync2/"; // v2: invalida os tokens de quando o multiget voltava vazio
/** Instante embutido no sync-token (null = token vazio/desconhecido). */
export function syncTokenTime(token: string): number | null {
  const m = token.trim().match(/\/sync2\/(\d+)-\d+$/);
  return m ? Number(m[1]) : null;
}

/* ── iCalendar ───────────────────────────────────────────────────────────── */

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsUnescape = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Quebra linhas em 75 octetos (RFC 5545 §3.1). */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function noteToIcs(n: SyncNote): string {
  // Sem mudança no GoHub desde a última gravação do iPhone → devolve o que ele mandou, byte a byte.
  if (n.caldavIcs && n.caldavIcsAt && n.updatedAt.getTime() - n.caldavIcsAt.getTime() < 3000) return n.caldavIcs;
  const uid = resourceName(n);
  // iOS: 1 = alta, 5 = média, 9 = baixa — espelha a matriz de Eisenhower.
  const priority = n.important ? (n.urgent ? 1 : 5) : 9;
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GoHub//Assistente//PT-BR", "CALSCALE:GREGORIAN",
    "BEGIN:VTODO",
    `UID:${uid}`,
    `DTSTAMP:${icsDate(n.updatedAt)}`,
    `CREATED:${icsDate(n.createdAt)}`,
    `LAST-MODIFIED:${icsDate(n.updatedAt)}`,
    `SUMMARY:${icsEscape(n.title)}`,
    ...(n.body ? [`DESCRIPTION:${icsEscape(n.body)}`] : []),
    `URL:${appUrl("/assistente?aba=bloquinho")}`,
    ...(n.tags.length ? [`CATEGORIES:${n.tags.map(icsEscape).join(",")}`] : []),
    `PRIORITY:${priority}`,
    ...(n.dueAt ? [`DUE:${icsDate(n.dueAt)}`] : []),
    `STATUS:${n.done ? "COMPLETED" : "NEEDS-ACTION"}`,
    ...(n.done ? [`COMPLETED:${icsDate(n.doneAt ?? n.updatedAt)}`, "PERCENT-COMPLETE:100"] : []),
    ...(n.dueAt && !n.done ? ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(n.title)}`, `TRIGGER;VALUE=DATE-TIME:${icsDate(n.dueAt)}`, "END:VALARM"] : []),
    "END:VTODO", "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export interface ParsedTodo { uid: string | null; title: string | null; body: string | null; dueAt: Date | null; completed: boolean; completedAt: Date | null }

/** Lê data do iCalendar: UTC ("…Z"), local/TZID (assume horário de Brasília) ou só data (9h). */
function parseIcsDate(value: string, params: string): Date | null {
  const v = value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h || /VALUE=DATE(?!-)/i.test(params)) return new Date(`${y}-${mo}-${d}T09:00:00${TZ_OFFSET}`);
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${z ? "Z" : TZ_OFFSET}`);
}

export function parseVtodo(ics: string): ParsedTodo | null {
  const lines = ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toUpperCase() === "BEGIN:VTODO");
  if (start < 0) return null;
  const out: ParsedTodo = { uid: null, title: null, body: null, dueAt: null, completed: false, completedAt: null };
  let alarmAt: Date | null = null;
  let depth = 0; // >0 = dentro de um sub-componente (VALARM)
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trimEnd();
    const up = line.toUpperCase();
    if (up === "END:VTODO" && depth === 0) break;
    if (up.startsWith("BEGIN:")) { depth++; continue; }
    if (up.startsWith("END:")) { depth = Math.max(0, depth - 1); continue; }
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name, ...rest] = head.split(";");
    const params = rest.join(";");
    const key = name.toUpperCase();
    if (depth > 0) {
      if (key === "TRIGGER" && /VALUE=DATE-TIME/i.test(params)) alarmAt = parseIcsDate(value, params);
      continue;
    }
    if (key === "UID") out.uid = value.trim();
    else if (key === "SUMMARY") out.title = icsUnescape(value).trim();
    else if (key === "DESCRIPTION") out.body = icsUnescape(value).trim() || null;
    else if (key === "DUE") out.dueAt = parseIcsDate(value, params);
    else if (key === "STATUS") out.completed = out.completed || value.trim().toUpperCase() === "COMPLETED";
    else if (key === "COMPLETED") { out.completed = true; out.completedAt = parseIcsDate(value, params); }
  }
  if (!out.dueAt && alarmAt) out.dueAt = alarmAt;
  return out;
}

/* ── XML (multistatus) ───────────────────────────────────────────────────── */

export const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function multistatus(responses: { href: string; props?: string; gone?: boolean }[], tail = ""): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ical="http://apple.com/ns/ical/">
${responses.map((r) => r.gone
    ? `<d:response><d:href>${xmlEscape(r.href)}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`
    : `<d:response><d:href>${xmlEscape(r.href)}</d:href><d:propstat><d:prop>${r.props ?? ""}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join("\n")}
${tail}</d:multistatus>`;
}

/* ── PROPPATCH (propriedades livres que o cliente grava na lista) ────────── */

export interface PatchedProp { key: string; ns: string; name: string; xml: string | null } // xml null = remover

/**
 * Lê um PROPPATCH: cada propriedade de <set>/<remove> vira {chave "{ns}nome",
 * XML pronto pra devolver no PROPFIND}. O iOS grava cor/ordem da lista e só
 * segue pra baixar os lembretes se cada propriedade voltar confirmada.
 */
export function parsePropPatch(body: string): PatchedProp[] {
  const nsMap: Record<string, string> = {};
  for (const m of body.matchAll(/xmlns(?::([\w-]+))?="([^"]*)"/g)) nsMap[m[1] ?? ""] = m[2];
  const out: PatchedProp[] = [];
  for (const block of body.matchAll(/<(?:[\w-]+:)?(set|remove)\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?\1>/g)) {
    const isSet = block[1] === "set";
    const prop = block[2].match(/<(?:[\w-]+:)?prop\b[^>]*>([\s\S]*)<\/(?:[\w-]+:)?prop>/);
    if (!prop) continue;
    const inner = prop[1];
    // varre os filhos de 1º nível de <prop>
    const tagRe = /<(\/?)(?:([\w-]+):)?([\w-]+)([^>]*?)(\/?)>/g;
    let depth = 0, start = -1, cur: { prefix: string; name: string; attrs: string } | null = null;
    for (let m = tagRe.exec(inner); m; m = tagRe.exec(inner)) {
      const [whole, closing, prefix = "", name, attrs, selfClose] = m;
      if (!closing && depth === 0) {
        cur = { prefix, name, attrs }; start = m.index;
        if (selfClose) { push(cur, ""); cur = null; continue; }
        depth = 1; continue;
      }
      if (closing) { depth--; if (depth === 0 && cur) { push(cur, inner.slice(start + inner.slice(start).indexOf(">") + 1, m.index)); cur = null; } }
      else if (!selfClose) depth++;
      void whole;
    }
    function push(c: { prefix: string; name: string; attrs: string }, value: string) {
      const ns = nsMap[c.prefix] ?? "DAV:";
      const xml = isSet ? `<${c.name} xmlns="${xmlEscape(ns)}">${value}</${c.name}>` : null;
      out.push({ key: `{${ns}}${c.name}`, ns, name: c.name, xml });
    }
  }
  return out;
}

export function propPatchResponse(href: string, props: PatchedProp[]): string {
  const els = props.map((p) => `<${p.name} xmlns="${xmlEscape(p.ns)}"/>`).join("");
  return `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:"><d:response><d:href>${xmlEscape(href)}</d:href><d:propstat><d:prop>${els}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
}
