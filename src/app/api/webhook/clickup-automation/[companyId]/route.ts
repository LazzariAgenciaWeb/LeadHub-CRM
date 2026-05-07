/**
 * POST /api/webhook/clickup-automation/[companyId]?token=<secret>&type=<comment|status|due-date>
 *
 * Webhook ClickUp → LeadHub via **Automações** (formato novo do ClickUp,
 * sem HMAC, sem evento explícito no payload). Diferente do endpoint
 * `/api/webhook/clickup/[companyId]` que valida HMAC `x-signature`.
 *
 * Como o ClickUp Automation só envia o estado da task (sem dizer o que
 * mudou e sem o texto do comentário), o frontend precisa criar 3
 * automações no ClickUp, cada uma apontando pra uma URL com `?type=`
 * diferente:
 *
 *   - type=comment   → trigger "Quando comentário for adicionado"
 *   - type=status    → trigger "Quando status mudar"
 *   - type=due-date  → trigger "Quando data de vencimento mudar"
 *
 * Para `comment` e `status`, fazemos chamada extra na API do ClickUp pra
 * buscar o que faltou no payload (texto do comentário / nome do status).
 *
 * Auth: `?token=<secret>` — usa o mesmo `clickup_webhook_secret:<companyId>`
 * configurado no painel. Sem token correto → 401.
 *
 * Lookup do lead: `payload.id` (clickupTaskId) restrito ao companyId do path.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, getClickupWebhookSecret } from "@/lib/clickup";

export const runtime = "nodejs";

const CLICKUP_BASE = "https://api.clickup.com/api/v2";
type EventType = "comment" | "status" | "due-date";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await params;
  if (!companyId) {
    return NextResponse.json({ error: "companyId obrigatorio" }, { status: 400 });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const type = (url.searchParams.get("type") ?? "") as EventType | "";

  if (!type || !["comment", "status", "due-date"].includes(type)) {
    return NextResponse.json(
      { error: "type invalido. Use ?type=comment|status|due-date" },
      { status: 400 }
    );
  }

  const expectedToken = await getClickupWebhookSecret(companyId);
  if (!expectedToken) {
    return NextResponse.json(
      { error: "Webhook nao configurado pra esta empresa" },
      { status: 403 }
    );
  }
  if (!token || token !== expectedToken) {
    return NextResponse.json({ error: "Token invalido" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  // Payload da Automação do ClickUp: { auto_id, trigger_id, date, payload: { id, ... } }
  const taskId: string | undefined = body?.payload?.id;
  if (!taskId) {
    return NextResponse.json({ error: "payload.id ausente" }, { status: 400 });
  }

  const lead = await prisma.lead.findFirst({
    where: { clickupTaskId: taskId, companyId },
    select: { id: true, companyId: true, pipeline: true },
  });
  if (!lead) {
    return NextResponse.json({ ok: true, skipped: "lead-not-found", taskId });
  }

  // Settings do ClickUp (precisamos do apiToken pra fetch de comentários/status)
  const settings = await getClickupSettings(companyId);

  // ── due-date ────────────────────────────────────────────────────────────────
  // Vem direto no payload, não precisa chamar API.
  if (type === "due-date") {
    const dueRaw = body?.payload?.time_mgmt?.due_date;
    let newDue: Date | null = null;
    if (dueRaw !== null && dueRaw !== undefined && dueRaw !== "") {
      const ms = typeof dueRaw === "number" ? dueRaw : parseInt(String(dueRaw), 10);
      if (Number.isFinite(ms)) newDue = new Date(ms);
    }
    await prisma.lead.update({
      where: { id: lead.id },
      data: { expectedReturnAt: newDue },
    });
    return NextResponse.json({ ok: true, type, expectedReturnAt: newDue });
  }

  // status & comment precisam da API do ClickUp
  if (!settings) {
    return NextResponse.json(
      { error: "ClickUp API token nao configurado — necessario pra buscar status/comentario" },
      { status: 503 }
    );
  }

  // ── status ──────────────────────────────────────────────────────────────────
  if (type === "status") {
    const res = await fetch(`${CLICKUP_BASE}/task/${taskId}`, {
      headers: { Authorization: settings.apiToken },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `ClickUp /task ${res.status}`, detail: await res.text() },
        { status: 502 }
      );
    }
    const task: any = await res.json();
    const statusName: string | undefined = task?.status?.status;
    if (!statusName) {
      return NextResponse.json({ ok: true, skipped: "no-status-name-from-api" });
    }

    const stage = await prisma.pipelineStageConfig.findFirst({
      where: {
        companyId: lead.companyId,
        ...(lead.pipeline ? { pipeline: lead.pipeline } : {}),
        name: { equals: statusName, mode: "insensitive" },
      },
      select: { name: true },
    });

    if (!stage) {
      return NextResponse.json({ ok: true, skipped: "stage-not-mapped", clickupStatus: statusName });
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: { pipelineStage: stage.name },
    });
    return NextResponse.json({ ok: true, type, pipelineStage: stage.name });
  }

  // ── comment ─────────────────────────────────────────────────────────────────
  // Busca os comentários da task e cria os que ainda não temos (dedup por externalId).
  // ClickUp retorna mais recentes primeiro — limitamos a últimos N pra evitar
  // varrer histórico inteiro toda vez.
  const COMMENT_FETCH_LIMIT = 25;
  const res = await fetch(`${CLICKUP_BASE}/task/${taskId}/comment`, {
    headers: { Authorization: settings.apiToken },
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: `ClickUp /task/comment ${res.status}`, detail: await res.text() },
      { status: 502 }
    );
  }
  const data: any = await res.json();
  const comments: any[] = Array.isArray(data?.comments) ? data.comments.slice(0, COMMENT_FETCH_LIMIT) : [];

  let created = 0;
  for (const c of comments) {
    const commentId = c?.id != null ? String(c.id) : "";
    if (!commentId) continue;

    const dup = await prisma.leadComment.findFirst({
      where: { externalId: commentId },
      select: { id: true },
    });
    if (dup) continue;

    const blocks = Array.isArray(c?.comment) ? c.comment : [];
    const fromBlocks = blocks.map((b: any) => b?.text ?? "").join("");
    const text = (c?.comment_text ?? c?.text_content ?? fromBlocks ?? "").trim();
    if (!text) continue;

    const author = c?.user?.username ?? c?.user?.email ?? "ClickUp";

    await prisma.leadComment.create({
      data: {
        body: text,
        authorName: author,
        source: "CLICKUP",
        externalId: commentId,
        leadId: lead.id,
      },
    });
    created++;
  }

  return NextResponse.json({ ok: true, type, created });
}
