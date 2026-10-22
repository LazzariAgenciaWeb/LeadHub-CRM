import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import { logNoteEvent } from "@/lib/personal-assistant/note-events";
import {
  CALDAV_BASE, COLLECTION, NOTE_SELECT, authenticateCaldav, collectionState, etagOf, syncTokenTime, hrefOf, multistatus,
  noteToIcs, parsePropPatch, parseVtodo, propPatchResponse, syncedWhere, xmlEscape, type SyncNote,
} from "@/lib/personal-assistant/caldav";

/**
 * Servidor CalDAV mínimo (só VTODO) — Lembretes do iPhone ⇄ bloquinho.
 * Fica no Pages Router porque o CalDAV usa PROPFIND/REPORT/PROPPATCH,
 * métodos que os route handlers do App Router não aceitam.
 *
 *   /api/caldav                 raiz → aponta o principal
 *   /api/caldav/principal       principal do usuário → aponta a home
 *   /api/caldav/cal             home → contém a lista "GoHub"
 *   /api/caldav/cal/gohub       a lista (VTODO)
 *   /api/caldav/cal/gohub/X.ics um lembrete
 */
export const config = { api: { bodyParser: false } };

const PRINCIPAL = `${CALDAV_BASE}/principal`;
const HOME = `${CALDAV_BASE}/cal`;

async function readBody(req: NextApiRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: NextApiResponse, status: number, body = "", type = "application/xml; charset=utf-8") {
  res.setHeader("DAV", "1, 2, 3, calendar-access");
  if (body) res.setHeader("Content-Type", type);
  res.status(status).send(body);
}

const privs = (list: string[]) => "<d:current-user-privilege-set>" + list.map((p) => `<d:privilege><d:${p}/></d:privilege>`).join("") + "</d:current-user-privilege-set>";
// Lista: pode criar/editar/apagar lembretes. Home: só leitura — sem "bind", senão o
// iOS tenta criar listas novas (MKCALENDAR) e a conta entra em erro.
const PRIVS = privs(["read", "write", "write-content", "write-properties", "bind", "unbind", "read-current-user-privilege-set"]);
const HOME_PRIVS = privs(["read", "read-current-user-privilege-set"]);

function collectionProps({ ctag, syncToken }: { ctag: string; syncToken: string }, stored: Record<string, string> = {}) {
  // O que o cliente gravou (cor, ordem, nome) tem precedência sobre o padrão.
  const mine = (key: string, xml: string) => (stored[key] ? "" : xml);
  return [
    ...Object.values(stored),
    "<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>",
    mine("{DAV:}displayname", "<d:displayname>GoHub</d:displayname>"),
    '<c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>',
    `<cs:getctag>${xmlEscape(ctag)}</cs:getctag>`,
    `<d:getetag>${xmlEscape(ctag)}</d:getetag>`,
    `<d:sync-token>${xmlEscape(syncToken)}</d:sync-token>`,
    mine("{http://apple.com/ns/ical/}calendar-color", "<ical:calendar-color>#C026D3FF</ical:calendar-color>"),
    `<d:owner><d:href>${PRINCIPAL}</d:href></d:owner>`,
    `<d:current-user-principal><d:href>${PRINCIPAL}</d:href></d:current-user-principal>`,
    "<d:supported-report-set><d:supported-report><d:report><c:calendar-multiget/></d:report></d:supported-report><d:supported-report><d:report><c:calendar-query/></d:report></d:supported-report><d:supported-report><d:report><d:sync-collection/></d:report></d:supported-report></d:supported-report-set>",
    PRIVS,
  ].join("");
}

const itemProps = (n: SyncNote, withData: boolean) =>
  `<d:getetag>${xmlEscape(etagOf(n))}</d:getetag><d:getcontenttype>text/calendar; charset=utf-8; component=VTODO</d:getcontenttype><d:resourcetype/>` +
  (withData ? `<c:calendar-data>${xmlEscape(noteToIcs(n))}</c:calendar-data>` : "");

/** Acha o item pelo nome do recurso (id do GoHub ou nome criado pelo iPhone). */
async function findByName(userId: string, name: string) {
  return prisma.assistantNote.findFirst({ where: { userId, OR: [{ id: name }, { caldavUid: name }] }, select: { ...NOTE_SELECT, archivedAt: true } });
}

/** Registra cada pedido (diagnóstico da sincronização) quando a resposta termina. */
function logRequest(req: NextApiRequest, res: NextApiResponse, method: string, userId: string | null) {
  const basic = (req.headers.authorization ?? "").match(/^Basic\s+(.+)$/i);
  const username = basic ? Buffer.from(basic[1], "base64").toString("utf8").split(":")[0] : null;
  res.on("finish", () => {
    const detail = (res as unknown as { _davBody?: string })._davBody || null;
    console.log(`[caldav] ${method} ${req.url} depth=${req.headers.depth ?? "-"} → ${res.statusCode} user=${username ?? "-"} ua=${(req.headers["user-agent"] ?? "").slice(0, 60)}`);
    prisma.caldavRequestLog.create({
      data: { userId, username, method, path: (req.url ?? "").slice(0, 300), depth: req.headers.depth ? String(req.headers.depth) : null, status: res.statusCode, userAgent: (req.headers["user-agent"] ?? "").slice(0, 200) || null, detail },
    }).catch(() => {});
    if (Math.random() < 0.05) prisma.caldavRequestLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 3 * 86400_000) } } }).catch(() => {});
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = (req.method ?? "GET").toUpperCase();
  const parts = ([] as string[]).concat(req.query.path ?? []).map((p) => decodeURIComponent(p));

  if (method === "OPTIONS") {
    res.setHeader("Allow", "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT");
    return send(res, 200);
  }

  const auth = await authenticateCaldav(req.headers.authorization);
  logRequest(req, res, method, auth?.userId ?? null);
  if (!auth) {
    res.setHeader("WWW-Authenticate", 'Basic realm="GoHub"');
    return send(res, 401, "Autenticação necessária", "text/plain; charset=utf-8");
  }
  const { userId } = auth;
  const loadStored = async () => ((await prisma.user.findUnique({ where: { id: userId }, select: { caldavProps: true } }))?.caldavProps ?? {}) as Record<string, string>;
  const body = ["PROPFIND", "REPORT", "PUT", "PROPPATCH"].includes(method) ? await readBody(req) : "";
  (res as unknown as { _davBody?: string })._davBody = body.slice(0, 600);
  const depth = String(req.headers.depth ?? "0");

  // Só existe a lista "GoHub": criar listas novas é recusado com motivo (403), não 404.
  if (method === "MKCALENDAR" || method === "MKCOL") {
    return send(res, 403, '<?xml version="1.0" encoding="utf-8"?><d:error xmlns:d="DAV:"><d:need-privileges/></d:error>');
  }

  // ── raiz / principal / home ───────────────────────────────────────────────
  if (parts.length === 0 || parts[0] === "principal" || (parts[0] === "cal" && parts.length === 1)) {
    if (method !== "PROPFIND") return send(res, method === "GET" ? 200 : 405, method === "GET" ? "GoHub CalDAV" : "", "text/plain; charset=utf-8");
    const common = `<d:current-user-principal><d:href>${PRINCIPAL}</d:href></d:current-user-principal><d:principal-URL><d:href>${PRINCIPAL}</d:href></d:principal-URL><c:calendar-home-set><d:href>${HOME}</d:href></c:calendar-home-set>`;
    if (parts.length === 0) return send(res, 207, multistatus([{ href: CALDAV_BASE, props: `<d:resourcetype><d:collection/></d:resourcetype>${common}` }]));
    if (parts[0] === "principal") {
      return send(res, 207, multistatus([{ href: PRINCIPAL, props: `<d:resourcetype><d:principal/></d:resourcetype><d:displayname>GoHub</d:displayname>${common}<c:calendar-user-address-set><d:href>mailto:${xmlEscape(auth.email)}</d:href></c:calendar-user-address-set>` }]));
    }
    const out = [{ href: HOME, props: `<d:resourcetype><d:collection/></d:resourcetype>${common}${HOME_PRIVS}` }];
    if (depth !== "0") out.push({ href: COLLECTION, props: collectionProps(await collectionState(userId), await loadStored()) });
    return send(res, 207, multistatus(out));
  }

  if (parts[0] !== "cal" || parts[1] !== "gohub" || parts.length > 3) return send(res, 404);

  // ── a lista ───────────────────────────────────────────────────────────────
  if (parts.length === 2) {
    if (method === "PROPPATCH") {
      // Cor/ordem/nome da lista: guarda e confirma cada propriedade (sem isso o iOS repete e não sincroniza).
      const patched = parsePropPatch(body);
      const stored = await loadStored();
      for (const p of patched) { if (p.xml) stored[p.key] = p.xml; else delete stored[p.key]; }
      await prisma.user.update({ where: { id: userId }, data: { caldavProps: stored } });
      console.log(`[caldav] PROPPATCH props: ${patched.map((p) => p.key).join(", ") || "(nenhuma)"}`);
      return send(res, 207, propPatchResponse(COLLECTION, patched));
    }
    if (method === "PROPFIND") {
      const out = [{ href: COLLECTION, props: collectionProps(await collectionState(userId), await loadStored()) }];
      if (depth !== "0") {
        const notes = await prisma.assistantNote.findMany({ where: syncedWhere(userId), select: NOTE_SELECT, take: 500 });
        for (const n of notes) out.push({ href: hrefOf(n), props: itemProps(n, false) });
      }
      return send(res, 207, multistatus(out));
    }
    if (method === "REPORT") {
      let notes: SyncNote[];
      const wantsData = /calendar-data/i.test(body);
      if (/sync-collection/i.test(body)) {
        // RFC 6578: com token → só o que mudou desde então (+ o que saiu da lista como 404); sem token → tudo.
        const given = body.match(/<(?:[\w-]+:)?sync-token\b[^>]*>([^<]*)<\/(?:[\w-]+:)?sync-token>/i)?.[1]?.trim() ?? "";
        const since = given ? syncTokenTime(given) : null;
        if (given && since === null) {
          return send(res, 403, '<?xml version="1.0" encoding="utf-8"?><d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>');
        }
        const state = await collectionState(userId);
        const current = await prisma.assistantNote.findMany({
          where: { ...syncedWhere(userId), ...(since !== null ? { updatedAt: { gt: new Date(since) } } : {}) },
          select: NOTE_SELECT, take: 500,
        });
        const out: { href: string; props?: string; gone?: boolean }[] = current.map((n) => ({ href: hrefOf(n), props: itemProps(n, wantsData) }));
        if (since !== null) {
          const keep = new Set(current.map((n) => n.id));
          const left = await prisma.assistantNote.findMany({ where: { userId, updatedAt: { gt: new Date(since) } }, select: { id: true, caldavUid: true }, take: 500 });
          for (const n of left) if (!keep.has(n.id)) out.push({ href: hrefOf(n), gone: true });
        }
        return send(res, 207, multistatus(out, `<d:sync-token>${xmlEscape(state.syncToken)}</d:sync-token>\n`));
      }
      if (/calendar-multiget/i.test(body)) {
        const names = [...body.matchAll(/<(?:[\w-]+:)?href\b[^>]*>([^<]+)<\/(?:[\w-]+:)?href>/gi)]
          .map((m) => decodeURIComponent(m[1].trim().split("/").pop() ?? "").replace(/\.ics$/i, "")).filter(Boolean);
        notes = names.length ? await prisma.assistantNote.findMany({ where: { userId, OR: [{ id: { in: names } }, { caldavUid: { in: names } }] }, select: NOTE_SELECT }) : [];
      } else if (/calendar-query/i.test(body)) {
        notes = await prisma.assistantNote.findMany({ where: syncedWhere(userId), select: NOTE_SELECT, take: 500 });
      } else {
        return send(res, 403, '<?xml version="1.0" encoding="utf-8"?><d:error xmlns:d="DAV:"><d:supported-report/></d:error>');
      }
      const withData = !/<(?:[\w-]+:)?prop>[\s\S]*?<\/(?:[\w-]+:)?prop>/i.test(body) || /calendar-data/i.test(body);
      return send(res, 207, multistatus(notes.map((n) => ({ href: hrefOf(n), props: itemProps(n, withData) }))));
    }
    if (method === "GET" || method === "HEAD") return send(res, 200, "GoHub", "text/plain; charset=utf-8");
    return send(res, 405);
  }

  // ── um lembrete ───────────────────────────────────────────────────────────
  const name = parts[2].replace(/\.ics$/i, "");
  const existing = await findByName(userId, name);

  if (method === "GET" || method === "HEAD") {
    if (!existing || existing.archivedAt) return send(res, 404);
    res.setHeader("ETag", etagOf(existing));
    return send(res, 200, method === "HEAD" ? "" : noteToIcs(existing), "text/calendar; charset=utf-8");
  }

  if (method === "PROPFIND") {
    if (!existing || existing.archivedAt) return send(res, 404);
    return send(res, 207, multistatus([{ href: hrefOf(existing), props: itemProps(existing, false) }]));
  }

  if (method === "DELETE") {
    // Apagou no iPhone → arquiva no GoHub (guardado, sem ocupar espaço).
    if (existing && !existing.archivedAt) {
      await prisma.assistantNote.update({ where: { id: existing.id }, data: { archivedAt: new Date() } });
      await logNoteEvent(existing.id, "EDITED", "IPHONE", "apagado nos Lembretes do iPhone → arquivado");
    }
    return send(res, 204);
  }

  if (method === "PUT") {
    const todo = parseVtodo(body);
    if (!todo) return send(res, 415, "Só lembretes (VTODO)", "text/plain; charset=utf-8");
    const now = new Date();

    if (!existing) {
      if (!todo.title) return send(res, 400, "Sem título", "text/plain; charset=utf-8");
      const created = await prisma.assistantNote.create({
        data: {
          userId, companyId: auth.companyId, kind: todo.dueAt ? "REMINDER" : "TASK", title: todo.title, body: todo.body, dueAt: todo.dueAt,
          source: "IPHONE", caldavUid: name, important: true, urgent: !!todo.dueAt && todo.dueAt.getTime() - now.getTime() < 48 * 3600_000,
          ...(todo.completed ? { done: true, doneAt: todo.completedAt ?? now } : {}),
        },
        select: NOTE_SELECT,
      });
      await logNoteEvent(created.id, "CREATED", "IPHONE", "criado nos Lembretes do iPhone");
      res.setHeader("ETag", etagOf(created));
      return send(res, 201);
    }

    const data: Record<string, unknown> = {};
    if (todo.title && todo.title !== existing.title) data.title = todo.title;
    if ((todo.body ?? null) !== (existing.body ?? null)) data.body = todo.body;
    if ((todo.dueAt?.getTime() ?? null) !== (existing.dueAt?.getTime() ?? null)) { data.dueAt = todo.dueAt; data.remindedAt = null; }
    const doneChanged = todo.completed !== existing.done;
    if (doneChanged) Object.assign(data, todo.completed ? { done: true, doneAt: todo.completedAt ?? now } : { done: false, doneAt: null });
    if (existing.archivedAt) data.archivedAt = null;

    const updated = Object.keys(data).length
      ? await prisma.assistantNote.update({ where: { id: existing.id }, data, select: NOTE_SELECT })
      : existing;
    if (doneChanged) await logNoteEvent(existing.id, todo.completed ? "DONE" : "REOPENED", "IPHONE", todo.completed ? "concluído no iPhone" : "reaberto no iPhone");
    const edited = ["title", "body", "dueAt"].filter((k) => k in data);
    if (edited.length) await logNoteEvent(existing.id, "EDITED", "IPHONE", `alterou ${edited.map((k) => ({ title: "título", body: "texto", dueAt: "data" })[k]).join(", ")} no iPhone`);
    res.setHeader("ETag", etagOf(updated));
    return send(res, 204);
  }

  return send(res, 405);
}

