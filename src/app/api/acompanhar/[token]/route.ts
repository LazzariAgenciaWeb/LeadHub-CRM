import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ticketByPublicToken } from "@/lib/ticket-public";
import { getClickupSettings, addCommentToClickupTask } from "@/lib/clickup";
import { sendPushToUser } from "@/lib/push";
import { loadTicketStages, syncStageStatus } from "@/lib/ticket-stages";

// POST /api/acompanhar/[token]
// Body: { name: string, text?: string, attachmentIds?: string[] }
//
// Retorno do CLIENTE no link público do chamado — sem login: o token vale só
// pra este chamado. Mesmo padrão do link de aprovação de peça
// (/api/aprovar/[token]): quem escreveu fica registrado pelo nome digitado.
// Chamado resolvido/fechado REABRE, porque o cliente voltou a falar.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ticket = await ticketByPublicToken(token);
  if (!ticket) return NextResponse.json({ error: "Link inválido ou expirado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim().slice(0, 80);
  const text = String(body?.text ?? "").trim().slice(0, 4000);
  const ids: string[] = Array.isArray(body?.attachmentIds)
    ? body.attachmentIds.filter((x: unknown) => typeof x === "string").slice(0, 10)
    : [];

  if (name.length < 2) return NextResponse.json({ error: "Informe seu nome." }, { status: 400 });

  // Anexos: só os que ESTE link subiu (DRAFT sem usuário, deste chamado).
  // Id de fora — ou rascunho da equipe, que tem uploadedById — é ignorado.
  const drafts = ids.length
    ? await prisma.storageObject.findMany({
        where:  { id: { in: ids }, ticketId: ticket.id, status: "DRAFT", uploadedById: null },
        select: { id: true, fileName: true },
      })
    : [];

  if (!text && drafts.length === 0) {
    return NextResponse.json({ error: "Escreva sua mensagem ou anexe um arquivo." }, { status: 400 });
  }

  const message = await prisma.ticketMessage.create({
    data: {
      ticketId:   ticket.id,
      body:       text,
      authorName: name,
      authorRole: "CLIENT",
      isInternal: false,
      source:     "CLIENT_PORTAL",
    },
    select: { id: true },
  });

  if (drafts.length) {
    await prisma.storageObject.updateMany({
      where: { id: { in: drafts.map((d) => d.id) } },
      data:  { ticketMessageId: message.id, status: "READY" },
    });
  }

  const reopened = ticket.status === "RESOLVED" || ticket.status === "CLOSED";
  // Reabrir tira o card da coluna final do kanban também.
  const stage = reopened
    ? syncStageStatus({
        stages:  await loadTicketStages(ticket.companyId),
        current: { status: ticket.status, ticketStage: ticket.ticketStage },
        next:    { status: "OPEN" },
      }).ticketStage
    : undefined;
  await prisma.ticket.update({
    where: { id: ticket.id },
    data:  reopened
      ? { status: "OPEN", ...(stage ? { ticketStage: stage } : {}), updatedAt: new Date() }
      : { updatedAt: new Date() },
  });

  if (reopened) {
    await prisma.activity.create({
      data: {
        type: "STATUS_CHANGED",
        body: `Chamado reaberto: ${name} respondeu pelo link de acompanhamento`,
        meta: { from: ticket.status, to: "OPEN", channel: "acompanhar" },
        authorName: name,
        ticketId:   ticket.id,
        companyId:  ticket.companyId,
      },
    }).catch(() => { /* não crítico */ });
  }

  // ClickUp (best-effort): o retorno do cliente aparece na tarefa, com o mesmo
  // rótulo das mensagens do portal. externalId evita duplicar no webhook.
  if (ticket.clickupTaskId) {
    try {
      const settings = await getClickupSettings(ticket.companyId);
      if (settings?.apiToken) {
        const anexos = drafts.length ? `\n\n📎 ${drafts.map((d) => d.fileName).join(", ")}` : "";
        const cid = await addCommentToClickupTask({
          apiToken: settings.apiToken,
          taskId:   ticket.clickupTaskId,
          comment:  `👤 Cliente — ${name}\n\n${text}${anexos}`,
        });
        if (cid) {
          await prisma.ticketMessage.update({ where: { id: message.id }, data: { externalId: cid } }).catch(() => {});
        }
      }
    } catch { /* silencioso: o retorno do cliente já está gravado */ }
  }

  // Avisa quem atende (ou quem abriu, se não tem responsável).
  const notify = ticket.assigneeId ?? ticket.createdById;
  if (notify) {
    void sendPushToUser(
      notify,
      {
        title: `💬 ${name} respondeu`,
        body:  (text || drafts.map((d) => d.fileName).join(", ")).slice(0, 120),
        url:   `/chamados/${ticket.id}`,
        tag:   `ticket-${ticket.id}`,
      },
      "newMessage",
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true, status: reopened ? "OPEN" : ticket.status }, { status: 201 });
}
