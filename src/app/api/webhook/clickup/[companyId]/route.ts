/**
 * POST /api/webhook/clickup/[companyId]
 *
 * Webhook do ClickUp → LeadHub, **per-empresa**. Cada empresa-cliente que
 * habilita `moduleClickup` configura o próprio webhook no workspace ClickUp
 * dela apontando pra essa URL com o seu companyId no path.
 *
 * Hoje trata só `taskCommentPosted` (comentário no card vira `TicketMessage`
 * no chamado correspondente).
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
import { getClickupWebhookSecret } from "@/lib/clickup";

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

  if (event === "taskCommentPosted" && taskId) {
    // Restringe ao companyId do path — não cria mensagem em ticket de outra
    // empresa mesmo se a task aparecer linkada lá por algum motivo.
    const ticket = await prisma.ticket.findFirst({
      where: { clickupTaskId: taskId, companyId },
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

  return NextResponse.json({ ok: true, skipped: event ?? "unknown-event" });
}
