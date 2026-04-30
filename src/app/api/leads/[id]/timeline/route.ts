import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

export type TimelineEventType =
  | "lead_created"
  | "comment"
  | "message_in"
  | "message_out"
  | "link_click"
  | "tracking_link_set"
  | "clickup_linked";

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: string;
  title: string;
  body?: string;
  meta?: Record<string, any>;
}

// GET /api/leads/[id]/timeline
// Agrega eventos do lead (criação, comentários, mensagens WhatsApp, cliques no link rastreado).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;

  const lead = await prisma.lead.findUnique({
    where: { id },
    select: {
      id: true,
      phone: true,
      source: true,
      companyId: true,
      createdAt: true,
      updatedAt: true,
      clickupTaskId: true,
      trackingLinkId: true,
      trackingLink: { select: { id: true, code: true, label: true } },
    },
  });
  if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

  // Verifica acesso (CLIENT só vê leads da própria empresa)
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;
  if (userRole !== "SUPER_ADMIN" && lead.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const events: TimelineEvent[] = [];

  // 1. Evento de criação
  events.push({
    id: `created-${lead.id}`,
    type: "lead_created",
    timestamp: lead.createdAt.toISOString(),
    title: "Lead criado",
    meta: { source: lead.source },
  });

  // 2. Comentários internos
  const comments = await prisma.leadComment.findMany({
    where: { leadId: lead.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  for (const c of comments) {
    events.push({
      id: `comment-${c.id}`,
      type: "comment",
      timestamp: c.createdAt.toISOString(),
      title: c.authorName,
      body: c.body,
    });
  }

  // 3. Mensagens WhatsApp (mesmo telefone + empresa)
  const messages = await prisma.message.findMany({
    where: { phone: lead.phone, companyId: lead.companyId },
    orderBy: { receivedAt: "desc" },
    take: 50,
    select: {
      id: true,
      body: true,
      direction: true,
      receivedAt: true,
      participantName: true,
      mediaType: true,
    },
  });
  for (const m of messages) {
    const isIn = m.direction === "INBOUND";
    const preview = m.body?.trim()
      ? (m.body.length > 140 ? m.body.slice(0, 140) + "…" : m.body)
      : (m.mediaType?.startsWith("image") ? "📷 Imagem"
        : m.mediaType?.startsWith("audio") ? "🎤 Áudio"
        : "(mídia)");
    events.push({
      id: `msg-${m.id}`,
      type: isIn ? "message_in" : "message_out",
      timestamp: m.receivedAt.toISOString(),
      title: isIn
        ? (m.participantName ? `${m.participantName} respondeu` : "Cliente respondeu")
        : "Mensagem enviada",
      body: preview,
    });
  }

  // 4. Cliques no link de rastreamento (se houver)
  if (lead.trackingLinkId) {
    const clicks = await prisma.clickEvent.findMany({
      where: { trackingLinkId: lead.trackingLinkId },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    for (const c of clicks) {
      events.push({
        id: `click-${c.id}`,
        type: "link_click",
        timestamp: c.createdAt.toISOString(),
        title: "Clique no link rastreado",
        body: c.targetLabel ?? c.targetUrl,
        meta: { url: c.targetUrl },
      });
    }

    // Marca o ato de vincular o link (aproximado: usa updatedAt do lead)
    events.push({
      id: `link-set-${lead.trackingLinkId}`,
      type: "tracking_link_set",
      timestamp: lead.updatedAt.toISOString(),
      title: "Link de rastreamento vinculado",
      body: lead.trackingLink?.label ?? `/r/${lead.trackingLink?.code ?? lead.trackingLinkId}`,
    });
  }

  // 5. ClickUp vinculado (sem histórico real — usa updatedAt)
  if (lead.clickupTaskId) {
    events.push({
      id: `clickup-${lead.clickupTaskId}`,
      type: "clickup_linked",
      timestamp: lead.updatedAt.toISOString(),
      title: "Tarefa vinculada no ClickUp",
      body: lead.clickupTaskId,
    });
  }

  // Ordena tudo do mais recente para o mais antigo
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return NextResponse.json(events);
}
