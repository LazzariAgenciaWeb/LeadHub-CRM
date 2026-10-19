import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAssistantToken } from "@/lib/personal-assistant/token-auth";
import { userCanUseAssistant } from "@/lib/personal-assistant/access";
import { sendAssistantMessage } from "@/lib/personal-assistant/whatsapp";
import { logNoteEvent } from "@/lib/personal-assistant/note-events";
import { intakeNote } from "@/lib/personal-assistant/intake";
import { parseTags } from "@/lib/personal-assistant/tags";
import { sendPushToUser } from "@/lib/push";
import { appUrl, fmtDateTime } from "@/lib/assistant-tools/types";

/**
 * POST /api/assistente/inbox — porta de ENTRADA pra rotinas externas
 * (Claude agendado, n8n, cron, curl). Autentica pelo token pessoal
 * (`Authorization: Bearer gohub_...` ou `?token=`).
 *
 * Body JSON:
 *   { title: string            — obrigatório
 *     body?: string            — detalhes (markdown simples)
 *     kind?: "NOTE"|"IDEA"|"TASK"|"REMINDER"  (default NOTE)
 *     tags?: string[]|string   — ex.: ["reels","conteudo"]
 *     dueAt?: ISO 8601         — pra TASK/REMINDER
 *     link?: string            — URL de referência (ClickUp, Gmail…)
 *     source?: string          — nome da rotina (vai pro histórico)
 *     notify?: boolean         — manda no WhatsApp + push (default true)
 *     onlyNotify?: boolean     — só avisa no WhatsApp, não guarda no bloquinho }
 *
 * Exemplo:
 *   curl -X POST https://app.../api/assistente/inbox \
 *     -H "Authorization: Bearer gohub_..." -H "Content-Type: application/json" \
 *     -d '{"title":"Reels novo pra gravar: 3 erros no tráfego","tags":["reels"],"link":"https://app.clickup.com/t/..."}'
 */
export const runtime = "nodejs";

const KINDS = new Set(["IDEA", "NOTE", "REMINDER", "TASK"]);

export async function POST(req: NextRequest) {
  const auth = await authenticateAssistantToken(req);
  if (!auth) return NextResponse.json({ error: "Não autorizado: envie Authorization: Bearer <token pessoal>" }, { status: 401 });
  if (!(await userCanUseAssistant(auth.userId))) return NextResponse.json({ error: "Assistente pessoal não liberado para a sua empresa" }, { status: 403 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "title obrigatório" }, { status: 400 });
  if (title.length > 300) return NextResponse.json({ error: "title muito longo (máx. 300)" }, { status: 400 });

  const kind = KINDS.has(body?.kind) ? body.kind : "NOTE";
  const text = typeof body?.body === "string" ? body.body.trim().slice(0, 8000) || null : null;
  const link = typeof body?.link === "string" && /^https?:\/\//.test(body.link) ? body.link.trim() : null;
  const source = typeof body?.source === "string" ? body.source.trim().slice(0, 80) : "webhook";
  const tags = parseTags(body?.tags);
  const notify = body?.notify !== false;
  const onlyNotify = body?.onlyNotify === true;
  let dueAt: Date | null = null;
  if (body?.dueAt) {
    dueAt = new Date(body.dueAt);
    if (Number.isNaN(dueAt.getTime())) return NextResponse.json({ error: "dueAt inválido" }, { status: 400 });
  }

  let noteId: string | null = null;
  let appended = false;
  let intakeAction: string | null = null;
  let intakeMessage: string | null = null;
  if (!onlyNotify) {
    const fullBody = [text, link ? `Link: ${link}` : null].filter(Boolean).join("\n\n") || null;
    const me = await prisma.user.findUnique({ where: { id: auth.userId }, select: { companyId: true, name: true } });
    const r = await intakeNote(
      { userId: auth.userId, companyId: me?.companyId ?? null, userName: me?.name ?? "Usuário", channel: "WEBHOOK", sourceLabel: source },
      { kind, title, body: fullBody, dueAt, tags, important: typeof body?.important === "boolean" ? body.important : undefined, urgent: typeof body?.urgent === "boolean" ? body.urgent : undefined, forceNew: body?.forceNew === true },
    );
    noteId = r.id; appended = r.action === "appended"; intakeAction = r.action; intakeMessage = r.message;
  }

  let notified = false;
  if (notify) {
    const icon = kind === "TASK" ? "☑️" : kind === "REMINDER" ? "⏰" : kind === "IDEA" ? "💡" : "📥";
    const msg = [
      `${icon} *${title}*${appended ? " _(atualização de item já anotado)_" : intakeAction === "resolved" ? " _(resolveu um item pendente ✅)_" : intakeAction === "delegated" ? " _(delegado por regra 👉)_" : intakeAction === "archived" || intakeAction === "done" ? " _(tratado por regra)_" : ""}`,
      text,
      dueAt ? `_${fmtDateTime(dueAt)}_` : null,
      tags.length ? tags.map((t) => `#${t}`).join(" ") : null,
      link,
      `_via ${source}_${noteId ? ` · ${appUrl("/assistente?aba=bloquinho")}` : ""}`,
    ].filter(Boolean).join("\n");
    notified = await sendAssistantMessage(auth.userId, msg);
    await sendPushToUser(auth.userId, { title: `${icon} ${title}`, body: (text ?? source).slice(0, 120), url: link ?? appUrl("/assistente?aba=bloquinho"), tag: `assistant-inbox-${noteId ?? Date.now()}` });
  }

  return NextResponse.json({ ok: true, noteId, action: intakeAction, message: intakeMessage, appended, notified, url: noteId ? appUrl("/assistente?aba=bloquinho") : null }, { status: intakeAction === "created" ? 201 : 200 });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    usage: "POST JSON { title, body?, kind?, tags?, dueAt?, link?, source?, notify?, onlyNotify? } com Authorization: Bearer <token pessoal>",
  });
}
