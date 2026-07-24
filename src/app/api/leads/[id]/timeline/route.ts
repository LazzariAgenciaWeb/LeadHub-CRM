import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

export type TimelineEventType =
  | "lead_created"
  | "comment"
  | "message_in"
  | "message_out"
  | "link_open"   // cliente abriu o shortlink /r/CODE (entrou na proposta)
  | "link_click"  // cliente clicou em algo DENTRO da página de destino
  | "tracking_link_set"
  | "hot_signal"  // tarefa auto-criada quando cliente abre o link (🔥 ligar agora)
  | "pipeline_changed" // ex: Lead → Oportunidade
  | "stage_changed"    // mudança de etapa dentro do mesmo pipeline
  | "assignee_changed" // mudou de responsável
  | "value_changed"    // valor da oportunidade alterado
  | "clickup_linked";

/**
 * Categorias de filtro usadas pela UI. Cada evento pertence a uma categoria.
 * Mantido aqui (server) e replicado no client pra evitar drift.
 */
export type TimelineGroup = "messages" | "links" | "system" | "notes";

export const EVENT_GROUP: Record<TimelineEventType, TimelineGroup> = {
  message_in:        "messages",
  message_out:       "messages",
  link_open:         "links",
  link_click:        "links",
  tracking_link_set: "links",
  hot_signal:        "links",
  comment:           "notes",
  lead_created:      "system",
  pipeline_changed:  "system",
  stage_changed:     "system",
  assignee_changed:  "system",
  value_changed:     "system",
  clickup_linked:    "system",
};

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
  req: NextRequest,
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

  // Cada bucket em try/catch independente — uma query quebrada NÃO deve
  // derrubar o resto. Sintoma observado: timeline retornava 500 e UI ficava
  // 100% vazia (sem comments, sem mensagens, sem cliques) quando UMA query
  // falhava por inconsistência de schema/banco. Cada bucket falha sozinho.

  // 2. Comentários internos
  try {
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
  } catch (e) {
    console.warn("[timeline] comments bucket falhou", e);
  }

  // 3. Mensagens WhatsApp (mesmo telefone + empresa)
  //
  // Por padrão traz só o CONTEXTO ao redor da abertura do lead: de N dias ANTES
  // da criação em diante (default 7). Evita carregar a conversa inteira e deixa
  // claro o que estava sendo tratado quando o lead entrou. `?msgDays=all` traz tudo.
  const msgDaysParam = req.nextUrl.searchParams.get("msgDays");
  const msgDays =
    msgDaysParam === "all" ? null : Math.max(0, Number(msgDaysParam ?? 7) || 0);
  const msgSince =
    msgDays === null ? null : new Date(lead.createdAt.getTime() - msgDays * 86_400_000);

  try {
    const messages = await prisma.message.findMany({
      where: {
        phone: lead.phone,
        companyId: lead.companyId,
        ...(msgSince ? { receivedAt: { gte: msgSince } } : {}),
      },
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
  } catch (e) {
    console.warn("[timeline] messages bucket falhou", e);
  }

  // 4. Cliques no link de rastreamento (se houver)
  if (lead.trackingLinkId) {
    try {
      const clicks = await prisma.clickEvent.findMany({
        where: { trackingLinkId: lead.trackingLinkId },
        orderBy: { createdAt: "desc" },
        take: 30,
      });
      for (const c of clicks) {
        const isOpen = (c as any).kind === "OPEN";
        events.push({
          id: `click-${c.id}`,
          type: isOpen ? "link_open" : "link_click",
          timestamp: c.createdAt.toISOString(),
          title: isOpen ? "Abriu o link" : "Clique dentro do link",
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
    } catch (e) {
      console.warn("[timeline] clicks bucket falhou", e);
    }
  }

  // 5. Sinais quentes (Tasks auto-criadas quando o cliente abre o link).
  // Aparecem como linha da timeline pra ter o histórico visível mesmo depois
  // que a tarefa for resolvida e sair de "Próximos Passos".
  //
  // Envolvido em try/catch porque: a coluna Task.source foi adicionada no
  // schema mas pode não estar no banco em ambientes que ainda não rodaram
  // `prisma db push` / `prisma migrate deploy`. Sem isso, a query inteira
  // joga e o endpoint retorna 500 — UI fica VAZIA (sem comments, sem
  // mensagens, sem cliques). Aqui falhamos gracefully só pra esse bucket.
  try {
    const hotTasks = await prisma.task.findMany({
      where: { leadId: lead.id, source: "AUTO_LINK_OPEN" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true, title: true, notes: true, done: true,
        createdAt: true, dueAt: true,
      },
    });
    for (const t of hotTasks) {
      events.push({
        id: `hot-${t.id}`,
        type: "hot_signal",
        timestamp: t.createdAt.toISOString(),
        title: t.done ? "🔥 Sinal Quente (resolvido)" : "🔥 Sinal Quente",
        body: t.notes ?? t.title,
        meta: { taskId: t.id, done: t.done, dueAt: t.dueAt?.toISOString() ?? null },
      });
    }
  } catch (e) {
    // Schema Task.source ausente no banco → ignora bucket, mantém o resto.
    console.warn("[timeline] hot_signal bucket falhou (Task.source?)", e);
  }

  // 6. Mudanças de pipeline/stage/assignee/value (Activity table).
  // PATCH /api/leads/:id já registra Activity nessas mudanças — aqui só
  // agregamos pra UI. Mostra o histórico "Virou Oportunidade", "Mudou de
  // etapa", "Passou pra Fulano" com data/hora.
  try {
    const activities = await prisma.activity.findMany({
      where: {
        leadId: lead.id,
        type: {
          in: ["PIPELINE_CHANGED", "STAGE_CHANGED", "ASSIGNEE_CHANGED", "VALUE_CHANGED"],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, type: true, body: true, meta: true,
        authorName: true, createdAt: true,
      },
    });
    for (const a of activities) {
      const meta = (a.meta ?? {}) as Record<string, any>;
      let title = a.body ?? "Mudança registrada";
      let typeOut: TimelineEventType = "pipeline_changed";

      if (a.type === "PIPELINE_CHANGED") {
        typeOut = "pipeline_changed";
        // Título mais útil quando vira oportunidade — ação que merece destaque.
        title = meta.to === "OPORTUNIDADES"
          ? "🎯 Virou Oportunidade"
          : meta.to === "LEADS"
          ? "Voltou pra Lead"
          : meta.to === "PROSPECCAO"
          ? "Voltou pra Prospecção"
          : `Pipeline: ${meta.from ?? "—"} → ${meta.to ?? "—"}`;
      } else if (a.type === "STAGE_CHANGED") {
        typeOut = "stage_changed";
        title = meta.to ? `Etapa: ${meta.to}` : "Mudou de etapa";
      } else if (a.type === "ASSIGNEE_CHANGED") {
        typeOut = "assignee_changed";
        title = a.body ?? "Responsável alterado";
      } else if (a.type === "VALUE_CHANGED") {
        typeOut = "value_changed";
        title = a.body ?? "Valor alterado";
      }

      events.push({
        id: `act-${a.id}`,
        type: typeOut,
        timestamp: a.createdAt.toISOString(),
        title,
        body: a.authorName ? `por ${a.authorName}` : undefined,
        meta,
      });
    }
  } catch (e) {
    console.warn("[timeline] activities bucket falhou", e);
  }

  // 7. ClickUp vinculado (sem histórico real — usa updatedAt)
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
