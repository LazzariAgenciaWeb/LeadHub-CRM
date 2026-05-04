/**
 * POST /api/webhook/clickup
 *
 * Webhook do ClickUp → LeadHub. Recebe eventos da workspace e mapeia pro chamado
 * correspondente (busca por `clickupTaskId`). Hoje trata só `taskCommentPosted`
 * (comentário no card vira `TicketMessage` no chamado).
 *
 * Configuração:
 *   1. ClickUp → Settings → Integrations → Webhooks → Create Webhook
 *   2. URL: https://seu-dominio.com/api/webhook/clickup
 *   3. Eventos: marcar `taskCommentPosted`
 *   4. Após criar, copiar o "Secret" exibido pelo ClickUp pra
 *      Setting `clickup_webhook_secret` (UI: /configuracoes → Integrações → ClickUp).
 *
 * Verificação de assinatura: ClickUp envia `X-Signature` = HMAC-SHA256 hex
 * do body cru com o secret. Comparação timing-safe via crypto.
 *
 * Dedup: TicketMessage.externalId guarda o ID do comentário do ClickUp.
 *   - Quando o LeadHub posta um comentário no ClickUp (messages/route.ts),
 *     a gente já grava o externalId retornado.
 *   - Quando o webhook chega com o mesmo comentário, o lookup por externalId
 *     pula a inserção. Evita loop infinito.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

// Webhook precisa do body cru pra validar a assinatura.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("x-signature");

  // Secret é global (a agência tem 1 conta no ClickUp). Per-empresa pode vir depois.
  const setting = await prisma.setting.findUnique({
    where: { key: "clickup_webhook_secret" },
  });
  const secret = setting?.value?.trim();

  if (!secret) {
    console.error("[ClickUp webhook] secret nao configurado em Setting");
    return NextResponse.json({ error: "Webhook nao configurado" }, { status: 500 });
  }
  if (!sig) {
    return NextResponse.json({ error: "Missing x-signature" }, { status: 400 });
  }

  const raw = await req.text();
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");

  // Comparação timing-safe
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

  if (event === "taskCommentPosted" && taskId) {
    // Encontra o chamado vinculado a essa task. Pode não existir (task de
    // oportunidade, ou task que o LeadHub nem criou) — retorna 200 pra ClickUp
    // não reentregar.
    const ticket = await prisma.ticket.findFirst({
      where: { clickupTaskId: taskId },
      select: { id: true, companyId: true },
    });
    if (!ticket) {
      return NextResponse.json({ ok: true, skipped: "ticket-not-found" });
    }

    const items = Array.isArray(payload?.history_items) ? payload.history_items : [];
    let created = 0;

    for (const item of items) {
      const c = item?.comment;
      if (!c) continue;
      const commentId = c.id != null ? String(c.id) : "";
      if (!commentId) continue;

      // Dedup: se o LeadHub já gravou esse comentário (via push pro ClickUp ou
      // por uma entrega anterior do mesmo webhook), pula.
      const dup = await prisma.ticketMessage.findFirst({
        where: { externalId: commentId },
        select: { id: true },
      });
      if (dup) continue;

      // Texto: o ClickUp manda em formatos diferentes dependendo do contexto.
      // Tenta na ordem: text_content (plain), comment_text (legacy), array de blocos.
      const blocks = Array.isArray(c.comment) ? c.comment : [];
      const fromBlocks = blocks.map((b: any) => b?.text ?? "").join("");
      const text = (c.text_content ?? c.comment_text ?? fromBlocks ?? "").trim();
      if (!text) continue;

      const author = item?.user?.username ?? item?.user?.email ?? "ClickUp";

      await prisma.ticketMessage.create({
        data: {
          body: text,
          authorName: author,
          // role só semântica de UI; a fonte real é source=CLICKUP
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

  // Eventos não tratados — 200 OK pro ClickUp não reentregar repetidamente.
  return NextResponse.json({ ok: true, skipped: event ?? "unknown-event" });
}
