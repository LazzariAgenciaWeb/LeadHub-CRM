/**
 * POST /api/webhook/clickup/[companyId]
 *
 * Webhook do ClickUp → LeadHub, **per-empresa**. Cada empresa-cliente que
 * habilita `moduleClickup` configura o próprio webhook no workspace ClickUp
 * dela apontando pra essa URL com o seu companyId no path.
 *
 * Eventos tratados:
 *   - `taskCommentPosted` → cria `TicketMessage` (chamado) ou `LeadComment`
 *     (oportunidade), conforme onde o `clickupTaskId` bate.
 *   - `taskStatusUpdated` (lead apenas) → atualiza `lead.pipelineStage`
 *     casando o nome do status do ClickUp contra `PipelineStageConfig.name`
 *     (case-insensitive) dentro da empresa. Sem match → ignora.
 *   - `taskUpdated` (lead apenas, mudança de due_date) → atualiza
 *     `lead.expectedReturnAt` com o novo timestamp.
 *
 * Configuração:
 *   1. /configuracoes → Integrações → ClickUp (com a empresa selecionada)
 *      mostra a URL exata e o campo do Webhook Secret.
 *   2. ClickUp → Settings → Integrations → Webhooks → Create Webhook
 *      - URL: copia da tela acima
 *      - Eventos: marcar `taskCommentPosted`
 *      - Após criar, copia o "Secret" exibido pelo ClickUp e cola no campo.
 *
 * Verificação de assinatura: ClickUp envia `X-Signature` = HMAC-SHA256 hex
 * do body cru com o secret. Comparação timing-safe via crypto.
 *
 * Dedup: TicketMessage.externalId guarda o ID do comentário do ClickUp.
 *   - Quando o LeadHub posta um comentário no ClickUp (messages/route.ts),
 *     já gravamos o externalId retornado.
 *   - Quando o webhook chega com o mesmo comentário, o lookup por externalId
 *     pula a inserção. Evita loop infinito.
 *
 * Isolamento entre empresas: além de validar o secret específico, restringe
 * a busca de tickets ao `companyId` do path — task de outra empresa não vaza
 * pra esta mesmo se a payload chegar aqui por engano.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getClickupWebhookSecret, getClickupSettings, fetchClickupTaskDescription, fetchClickupTaskComments, fetchClickupTaskLite } from "@/lib/clickup";
import { readComments, sanitizeComments } from "@/lib/checklist";
import { mirrorClickupTasks } from "@/lib/project-mirror";

// Webhook precisa do body cru pra validar a assinatura.
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await params;
  if (!companyId) {
    return NextResponse.json({ error: "companyId obrigatorio" }, { status: 400 });
  }

  const sig = req.headers.get("x-signature");
  const secret = await getClickupWebhookSecret(companyId);

  if (!secret) {
    // Empresa sem moduleClickup ativo OU sem secret salvo — rejeita pra
    // ClickUp não reentregar. Pode logar pra debug.
    return NextResponse.json({ error: "Webhook nao configurado pra esta empresa" }, { status: 403 });
  }
  if (!sig) {
    return NextResponse.json({ error: "Missing x-signature" }, { status: 400 });
  }

  const raw = await req.text();
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");

  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.json({ error: "Assinatura invalida" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const event = payload?.event as string | undefined;
  const taskId = payload?.task_id as string | undefined;

  if (!event || !taskId) {
    return NextResponse.json({ ok: true, skipped: "missing-event-or-task" });
  }

  // Descobre se a task corresponde a um Ticket OU a um Lead desta empresa.
  // Lookup paralelo — ClickUp lists são distintas (chamados vs oportunidades),
  // então no normal só um dos dois bate.
  const [ticket, lead, projTask] = await Promise.all([
    prisma.ticket.findFirst({
      where: { clickupTaskId: taskId, companyId },
      select: { id: true, companyId: true },
    }),
    prisma.lead.findFirst({
      where: { clickupTaskId: taskId, companyId },
      select: { id: true, companyId: true, pipeline: true },
    }),
    prisma.projectTask.findFirst({
      where: { clickupTaskId: taskId, project: { setor: { companyId } } },
      select: { id: true, comments: true },
    }),
  ]);

  // Auto-espelho em tempo real: se a task não bate com nada MAS pertence a uma
  // lista de PROJETO desta empresa (tarefa nova ainda não espelhada), cria a
  // ProjectTask nativa (oculta + sem serviço → Caixa de entrada) e segue o fluxo
  // pra aplicar descritivo/comentários do evento na recém-criada.
  let projectTaskRow = projTask;
  if (!ticket && !lead && !projTask) {
    const settings = await getClickupSettings(companyId);
    if (settings?.apiToken) {
      const info = await fetchClickupTaskLite(settings.apiToken, taskId);
      if (info?.listId) {
        const proj = await prisma.setorClickupList.findFirst({
          where:  { clickupListId: info.listId, setor: { companyId } },
          select: { id: true },
        });
        if (proj) {
          await mirrorClickupTasks(proj.id, [info.task]).catch(() => {});
          projectTaskRow = await prisma.projectTask.findFirst({
            where:  { clickupTaskId: taskId, project: { setor: { companyId } } },
            select: { id: true, comments: true },
          });
        }
      }
    }
  }

  if (!ticket && !lead && !projectTaskRow) {
    return NextResponse.json({ ok: true, skipped: "task-not-found" });
  }

  // ─── TAREFA DE PROJETO (painel do cliente) ──────────────────────────────────
  // taskUpdated → puxa o descritivo atual; taskCommentPosted → traz os comentários
  // como atualizações do cliente (merge deduplicado por texto+data). Busca via API
  // pra pegar o conteúdo consolidado, evitando parsear history_items.
  if (projectTaskRow) {
    const projTask = projectTaskRow;
    const settings = await getClickupSettings(companyId);
    if (!settings) return NextResponse.json({ ok: true, skipped: "clickup-not-configured" });
    const data: any = {};

    if (event === "taskUpdated") {
      try { const d = await fetchClickupTaskDescription(settings.apiToken, taskId); if (d) data.description = d; } catch { /* silencioso */ }
    }
    if (event === "taskCommentPosted") {
      try {
        const cmts = await fetchClickupTaskComments(settings.apiToken, taskId);
        const existing = readComments(projTask.comments);
        const seen = new Set(existing.map((c) => `${c.text}|${c.at}`));
        const seenCid = new Set(existing.map((c) => c.cid).filter(Boolean));
        // dedup por id do ClickUp (evita eco do que o LeadHub empurrou) + texto|data.
        const fresh = cmts.filter((c) => !(c.cid && seenCid.has(c.cid)) && !seen.has(`${c.text}|${c.at}`));
        if (fresh.length) {
          const merged = sanitizeComments(
            [...existing, ...fresh].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
          );
          if (merged) data.comments = merged;
        }
      } catch { /* silencioso */ }
    }

    if (Object.keys(data).length) {
      await prisma.projectTask.update({ where: { id: projTask.id }, data }).catch(() => {});
    }
    return NextResponse.json({ ok: true, projectTask: projTask.id, updated: Object.keys(data) });
  }

  // ─── TICKET (chamados) ──────────────────────────────────────────────────────
  if (ticket) {
    if (event !== "taskCommentPosted") {
      return NextResponse.json({ ok: true, skipped: `ticket-event-${event}` });
    }

    const items = Array.isArray(payload?.history_items) ? payload.history_items : [];
    let created = 0;

    for (const item of items) {
      const c = item?.comment;
      if (!c) continue;
      const commentId = c.id != null ? String(c.id) : "";
      if (!commentId) continue;

      const dup = await prisma.ticketMessage.findFirst({
        where: { externalId: commentId },
        select: { id: true },
      });
      if (dup) continue;

      const blocks = Array.isArray(c.comment) ? c.comment : [];
      const fromBlocks = blocks.map((b: any) => b?.text ?? "").join("");
      const text = (c.text_content ?? c.comment_text ?? fromBlocks ?? "").trim();
      if (!text) continue;

      const author = item?.user?.username ?? item?.user?.email ?? "ClickUp";

      await prisma.ticketMessage.create({
        data: {
          body: text,
          authorName: author,
          authorRole: "CLIENT",
          isInternal: false,
          source: "CLICKUP",
          externalId: commentId,
          ticketId: ticket.id,
        },
      });
      created++;
    }

    return NextResponse.json({ ok: true, created });
  }

  // ─── LEAD (oportunidades) ───────────────────────────────────────────────────
  // (lead garantido != null aqui — caso contrário caímos no early-return acima)
  if (event === "taskCommentPosted") {
    const items = Array.isArray(payload?.history_items) ? payload.history_items : [];
    let created = 0;

    for (const item of items) {
      const c = item?.comment;
      if (!c) continue;
      const commentId = c.id != null ? String(c.id) : "";
      if (!commentId) continue;

      const dup = await prisma.leadComment.findFirst({
        where: { externalId: commentId },
        select: { id: true },
      });
      if (dup) continue;

      const blocks = Array.isArray(c.comment) ? c.comment : [];
      const fromBlocks = blocks.map((b: any) => b?.text ?? "").join("");
      const text = (c.text_content ?? c.comment_text ?? fromBlocks ?? "").trim();
      if (!text) continue;

      const author = item?.user?.username ?? item?.user?.email ?? "ClickUp";

      await prisma.leadComment.create({
        data: {
          body: text,
          authorName: author,
          source: "CLICKUP",
          externalId: commentId,
          leadId: lead!.id,
        },
      });
      created++;
    }

    return NextResponse.json({ ok: true, created });
  }

  if (event === "taskStatusUpdated") {
    // Pega o nome do novo status no payload — pode vir em formatos diferentes.
    // Forma comum: history_items[].after.status (string com o nome).
    const items = Array.isArray(payload?.history_items) ? payload.history_items : [];
    let newStatusName: string | null = null;
    for (const item of items) {
      const after = item?.after;
      if (typeof after === "string" && after.trim()) { newStatusName = after.trim(); break; }
      if (after && typeof after === "object") {
        const s = after.status ?? after.status_type ?? null;
        if (typeof s === "string" && s.trim()) { newStatusName = s.trim(); break; }
      }
    }
    // Fallback: payload.history_items[].data?.status_after?.status
    if (!newStatusName) {
      for (const item of items) {
        const s = item?.data?.status_after?.status ?? item?.data?.status?.after ?? null;
        if (typeof s === "string" && s.trim()) { newStatusName = s.trim(); break; }
      }
    }
    if (!newStatusName) {
      return NextResponse.json({ ok: true, skipped: "no-status-in-payload" });
    }

    // Casa contra PipelineStageConfig pelo nome (case-insensitive), restrito à
    // empresa. Se o lead tem `pipeline` setado, prioriza match dentro do
    // mesmo pipeline; caso contrário aceita qualquer pipeline.
    const stage = await prisma.pipelineStageConfig.findFirst({
      where: {
        companyId: lead!.companyId,
        ...(lead!.pipeline ? { pipeline: lead!.pipeline } : {}),
        name: { equals: newStatusName, mode: "insensitive" },
      },
      select: { name: true },
    });

    if (!stage) {
      return NextResponse.json({ ok: true, skipped: "stage-not-mapped", clickupStatus: newStatusName });
    }

    await prisma.lead.update({
      where: { id: lead!.id },
      data: { pipelineStage: stage.name },
    });

    return NextResponse.json({ ok: true, updatedPipelineStage: stage.name });
  }

  if (event === "taskUpdated") {
    // Procura mudança de due_date nos history_items.
    const items = Array.isArray(payload?.history_items) ? payload.history_items : [];
    let newDueRaw: unknown = undefined; // null → limpar; string/number → setar; undefined → não veio
    for (const item of items) {
      const field = (item?.field ?? "").toString();
      if (field === "due_date") {
        newDueRaw = item?.after ?? null; // ClickUp manda null pra "removido"
        break;
      }
    }

    if (newDueRaw === undefined) {
      return NextResponse.json({ ok: true, skipped: "no-due-date-change" });
    }

    let newDue: Date | null = null;
    if (newDueRaw !== null && newDueRaw !== "") {
      const ms = typeof newDueRaw === "number" ? newDueRaw : parseInt(String(newDueRaw), 10);
      if (Number.isFinite(ms)) newDue = new Date(ms);
    }

    await prisma.lead.update({
      where: { id: lead!.id },
      data: { expectedReturnAt: newDue },
    });

    return NextResponse.json({ ok: true, updatedExpectedReturnAt: newDue });
  }

  return NextResponse.json({ ok: true, skipped: `lead-event-${event}` });
}
