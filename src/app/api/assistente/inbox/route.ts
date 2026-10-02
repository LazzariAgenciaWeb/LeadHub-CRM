import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAssistantToken } from "@/lib/personal-assistant/token-auth";
import { userCanUseAssistant } from "@/lib/personal-assistant/access";
import { sendAssistantMessage } from "@/lib/personal-assistant/whatsapp";
import { logNoteEvent } from "@/lib/personal-assistant/note-events";
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
  if (!onlyNotify) {
    const me = await prisma.user.findUnique({ where: { id: auth.userId }, select: { companyId: true } });
    const note = await prisma.assistantNote.create({
      data: {
        userId: auth.userId, companyId: me?.companyId ?? null, kind, title,
        body: [text, link ? `Link: ${link}` : null].filter(Boolean).join("\n\n") || null,
        dueAt, tags, source: "WEBHOOK",
      },
      select: { id: true },
    });
    noteId = note.id;
    await logNoteEvent(note.id, "CREATED", "WEBHOOK", `rotina: ${source}`);
  }

  let notified = false;
  if (notify) {
    const icon = kind === "TASK" ? "☑️" : kind === "REMINDER" ? "⏰" : kind === "IDEA" ? "💡" : "📥";
    const msg = [
      `${icon} *${title}*`,
      text,
      dueAt ? `_${fmtDateTime(dueAt)}_` : null,
      tags.length ? tags.map((t) => `#${t}`).join(" ") : null,
      link,
      `_via ${source}_${noteId ? ` · ${appUrl("/assistente?aba=bloquinho")}` : ""}`,
    ].filter(Boolean).join("\n");
    notified = await sendAssistantMessage(auth.userId, msg);
    await sendPushToUser(auth.userId, { title: `${icon} ${title}`, body: (text ?? source).slice(0, 120), url: link ?? appUrl("/assistente?aba=bloquinho"), tag: `assistant-inbox-${noteId ?? Date.now()}` });
  }

  return NextResponse.json({ ok: true, noteId, notified, url: noteId ? appUrl("/assistente?aba=bloquinho") : null }, { status: 201 });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    usage: "POST JSON { title, body?, kind?, tags?, dueAt?, link?, source?, notify?, onlyNotify? } com Authorization: Bearer <token pessoal>",
  });
}
