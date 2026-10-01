import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/leads/[id]/journey
 *
 * Jornada do lead até a venda: só os MARCOS (de onde veio, primeiro contato,
 * IA entrou, atendente entrou, mudanças de funil/etapa/status, link aberto,
 * ganho/perdido), em ordem cronológica, mais um resumo.
 *
 * Diferente da timeline (/timeline), que lista toda mensagem e anotação.
 * Nada aqui é gravado de novo — tudo é derivado do que o sistema já registra
 * (Lead, Activity, Message, IgMessage, Conversation, ClickEvent).
 *
 * Oportunidade que veio de lead é o MESMO registro (só muda o pipeline), então
 * o histórico já vem junto. Para cobrir oportunidade criada como registro à
 * parte, também entram os registros "irmãos" (mesmo telefone, mesma empresa).
 */

export type JourneyKind =
  | "origin" | "previous" | "first_contact" | "ai" | "human" | "assigned"
  | "pipeline" | "stage" | "status" | "link" | "value" | "won" | "lost";

export interface JourneyStep {
  id: string;
  kind: JourneyKind;
  timestamp: string;
  title: string;
  detail?: string;
  actor?: string;
}

export interface JourneySummary {
  origin: string;
  startedAt: string;
  days: number;
  outcome: "won" | "lost" | "open";
  value: number | null;
  messagesIn: number;
  messagesOut: number;
  aiInvolved: boolean;
  attendants: string[];
  firstResponseMinutes: number | null;
}

const SOURCE_LABEL: Record<string, string> = {
  whatsapp:  "WhatsApp",
  instagram: "Instagram",
  facebook:  "Facebook",
  google:    "Google",
  link:      "Link rastreado",
  bdr:       "Prospecção (BDR)",
  manual:    "Cadastro manual",
  webhook:   "Webhook / formulário",
};

const PIPELINE_LABEL: Record<string, string> = {
  PROSPECCAO:    "Prospecção",
  LEADS:         "Leads",
  OPORTUNIDADES: "Oportunidades",
};

const PROMOTED_REASON: Record<string, string> = {
  link_click:     "clicou no link",
  email_click:    "clicou no email",
  whatsapp_reply: "respondeu no WhatsApp",
};

function sourceLabel(s: string | null | undefined) {
  if (!s) return "Não informada";
  return SOURCE_LABEL[s.toLowerCase()] ?? s;
}

function preview(text: string | null | undefined, max = 120) {
  const t = text?.trim();
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max) + "…" : t;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: {
      id: true, phone: true, instagram: true, source: true, companyId: true,
      createdAt: true, pipeline: true, value: true, wonAt: true, lostAt: true,
      conversationId: true, eventSourceUrl: true, fbc: true,
      promotedFromPipeline: true, promotedAt: true, promotedReason: true,
      diagnosisClickedAt: true, trackingLinkId: true,
      campaign: { select: { name: true } },
      trackingLink: { select: { label: true, code: true } },
      promotedViaEmailCampaign: { select: { name: true } },
    },
  });
  if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;
  if (userRole !== "SUPER_ADMIN" && lead.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const steps: JourneyStep[] = [];
  const companyId = lead.companyId;
  const phone = lead.phone?.trim() || null;

  // ── Registros irmãos (mesmo telefone) — ex.: oportunidade criada à parte ──
  const siblings = phone
    ? await prisma.lead.findMany({
        where: { companyId, phone, id: { not: lead.id } },
        select: { id: true, pipeline: true, source: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }).catch(() => [])
    : [];
  const leadIds = [lead.id, ...siblings.map((s) => s.id)];

  // O registro mais antigo define a ORIGEM da jornada.
  const records = [
    { id: lead.id, pipeline: lead.pipeline, source: lead.source, createdAt: lead.createdAt },
    ...siblings,
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const first = records[0];

  // ── 1. Origem ──────────────────────────────────────────────────────────────
  const originDetail: string[] = [];
  if (lead.campaign?.name) originDetail.push(`Campanha: ${lead.campaign.name}`);
  if (lead.promotedViaEmailCampaign?.name) originDetail.push(`Email marketing: ${lead.promotedViaEmailCampaign.name}`);
  if (lead.trackingLink) originDetail.push(`Link: ${lead.trackingLink.label ?? `/r/${lead.trackingLink.code}`}`);
  if (lead.fbc) originDetail.push("Clique em anúncio do Meta");
  if (lead.eventSourceUrl) originDetail.push(`Página: ${lead.eventSourceUrl}`);

  steps.push({
    id: `origin-${first.id}`,
    kind: "origin",
    timestamp: first.createdAt.toISOString(),
    title: `Entrou via ${sourceLabel(first.source)} em ${PIPELINE_LABEL[first.pipeline ?? ""] ?? first.pipeline ?? "—"}`,
    detail: originDetail.join(" · ") || undefined,
  });
  for (const r of records.slice(1)) {
    steps.push({
      id: `previous-${r.id}`,
      kind: "previous",
      timestamp: r.createdAt.toISOString(),
      title: `Novo registro criado em ${PIPELINE_LABEL[r.pipeline ?? ""] ?? r.pipeline ?? "—"}`,
      detail: r.id === lead.id ? "Este registro" : "Registro do mesmo contato",
    });
  }

  // ── 2. Conversa do WhatsApp: 1º contato, IA, atendentes ────────────────────
  let messagesIn = 0;
  let messagesOut = 0;
  let aiInvolved = false;
  const attendants = new Set<string>();
  let firstInAt: Date | null = null;
  let firstResponseMinutes: number | null = null;

  const conversation = await prisma.conversation.findFirst({
    where: lead.conversationId
      ? { id: lead.conversationId }
      : phone ? { companyId, phone } : { id: "__none__" },
    select: { id: true, aiPausedAt: true },
  }).catch(() => null);

  if (phone) {
    try {
      const [firstIn, firstAi, countIn, countOut, humanFirsts] = await Promise.all([
        prisma.message.findFirst({
          where: { companyId, phone, direction: "INBOUND" },
          orderBy: { receivedAt: "asc" },
          select: { id: true, body: true, receivedAt: true },
        }),
        prisma.message.findFirst({
          where: { companyId, phone, direction: "OUTBOUND", sentByAI: true },
          orderBy: { receivedAt: "asc" },
          select: { id: true, body: true, receivedAt: true },
        }),
        prisma.message.count({ where: { companyId, phone, direction: "INBOUND" } }),
        prisma.message.count({ where: { companyId, phone, direction: "OUTBOUND" } }),
        prisma.message.groupBy({
          by: ["sentByUserId"],
          where: {
            companyId, phone, direction: "OUTBOUND",
            sentByAI: false, sentByUserId: { not: null },
          },
          _min: { receivedAt: true },
        }),
      ]);
      messagesIn += countIn;
      messagesOut += countOut;

      if (firstIn) {
        firstInAt = firstIn.receivedAt;
        steps.push({
          id: `first-in-${firstIn.id}`,
          kind: "first_contact",
          timestamp: firstIn.receivedAt.toISOString(),
          title: "Primeira mensagem do cliente no WhatsApp",
          detail: preview(firstIn.body),
        });
        // Tempo de 1ª resposta: primeira saída (IA ou humano) depois do 1º contato.
        const firstOut = await prisma.message.findFirst({
          where: { companyId, phone, direction: "OUTBOUND", receivedAt: { gte: firstIn.receivedAt } },
          orderBy: { receivedAt: "asc" },
          select: { receivedAt: true },
        });
        if (firstOut) {
          firstResponseMinutes = Math.round(
            (firstOut.receivedAt.getTime() - firstIn.receivedAt.getTime()) / 60000,
          );
        }
      }

      if (firstAi) {
        aiInvolved = true;
        steps.push({
          id: `ai-${firstAi.id}`,
          kind: "ai",
          timestamp: firstAi.receivedAt.toISOString(),
          title: "Agente de IA entrou na conversa (WhatsApp)",
          detail: preview(firstAi.body),
        });
      }

      const userIds = humanFirsts.map((h) => h.sentByUserId).filter(Boolean) as string[];
      if (userIds.length > 0) {
        const users = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        });
        const nameById = new Map(users.map((u) => [u.id, u.name]));
        for (const h of humanFirsts) {
          if (!h.sentByUserId || !h._min.receivedAt) continue;
          const name = nameById.get(h.sentByUserId) ?? "Atendente";
          attendants.add(name);
          steps.push({
            id: `human-${h.sentByUserId}`,
            kind: "human",
            timestamp: h._min.receivedAt.toISOString(),
            title: `${name} entrou no atendimento`,
            detail: "Primeira resposta dele(a) nesta conversa",
            actor: name,
          });
        }
      }
    } catch (e) {
      console.warn("[journey] whatsapp bucket falhou", e);
    }
  }

  if (conversation?.aiPausedAt) {
    steps.push({
      id: `ai-paused-${conversation.id}`,
      kind: "human",
      timestamp: conversation.aiPausedAt.toISOString(),
      title: "IA pausada — atendimento humano assumiu",
    });
  }

  // ── 3. Direct do Instagram / Messenger ─────────────────────────────────────
  try {
    const igConvs = await prisma.igConversation.findMany({
      where: {
        companyId,
        OR: [
          { leadId: { in: leadIds } },
          ...(lead.instagram
            ? [{ participantUsername: { equals: lead.instagram, mode: "insensitive" as const } }]
            : []),
        ],
      },
      select: { id: true, channel: true },
    });
    if (igConvs.length > 0) {
      const convIds = igConvs.map((c) => c.id);
      const channelName = igConvs[0].channel === "MESSENGER" ? "Messenger" : "Instagram";
      const [igFirstIn, igFirstAi, igFirstAgent, igIn, igOut] = await Promise.all([
        prisma.igMessage.findFirst({
          where: { conversationId: { in: convIds }, direction: "IN" },
          orderBy: { createdAt: "asc" },
          select: { id: true, text: true, createdAt: true },
        }),
        prisma.igMessage.findFirst({
          where: { conversationId: { in: convIds }, direction: "OUT", source: "AI" },
          orderBy: { createdAt: "asc" },
          select: { id: true, text: true, createdAt: true },
        }),
        prisma.igMessage.findFirst({
          where: { conversationId: { in: convIds }, direction: "OUT", source: { in: ["AGENT", "EXTERNAL"] } },
          orderBy: { createdAt: "asc" },
          select: { id: true, createdAt: true },
        }),
        prisma.igMessage.count({ where: { conversationId: { in: convIds }, direction: "IN" } }),
        prisma.igMessage.count({ where: { conversationId: { in: convIds }, direction: "OUT" } }),
      ]);
      messagesIn += igIn;
      messagesOut += igOut;

      if (igFirstIn) {
        if (!firstInAt || igFirstIn.createdAt < firstInAt) firstInAt = igFirstIn.createdAt;
        steps.push({
          id: `ig-first-${igFirstIn.id}`,
          kind: "first_contact",
          timestamp: igFirstIn.createdAt.toISOString(),
          title: `Primeira mensagem do cliente no ${channelName}`,
          detail: preview(igFirstIn.text),
        });
      }
      if (igFirstAi) {
        aiInvolved = true;
        steps.push({
          id: `ig-ai-${igFirstAi.id}`,
          kind: "ai",
          timestamp: igFirstAi.createdAt.toISOString(),
          title: `Agente de IA entrou na conversa (${channelName})`,
          detail: preview(igFirstAi.text),
        });
      }
      if (igFirstAgent) {
        steps.push({
          id: `ig-human-${igFirstAgent.id}`,
          kind: "human",
          timestamp: igFirstAgent.createdAt.toISOString(),
          title: `Atendente respondeu no ${channelName}`,
        });
      }
    }
  } catch (e) {
    console.warn("[journey] instagram bucket falhou", e);
  }

  // ── 4. Activity: funil, etapa, responsável, status, valor, qualificação IA ─
  try {
    const activities = await prisma.activity.findMany({
      where: {
        OR: [
          { leadId: { in: leadIds } },
          ...(conversation ? [{ conversationId: conversation.id }] : []),
        ],
        type: {
          in: [
            "PIPELINE_CHANGED", "STAGE_CHANGED", "STATUS_CHANGED", "ASSIGNEE_CHANGED",
            "SECTOR_CHANGED", "TRANSFERRED", "VALUE_CHANGED", "TRACKING_LINK_SET",
            "CONVERSATION_CLOSED", "CONVERSATION_REOPENED", "NOTE_ADDED",
          ],
        },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, type: true, body: true, meta: true, authorName: true, createdAt: true },
    });

    for (const a of activities) {
      const meta = (a.meta ?? {}) as Record<string, any>;
      const ts = a.createdAt.toISOString();
      const actor = a.authorName ?? undefined;

      switch (a.type) {
        case "PIPELINE_CHANGED": {
          const to = meta.to as string | undefined;
          steps.push({
            id: `act-${a.id}`, kind: "pipeline", timestamp: ts, actor,
            title: to === "OPORTUNIDADES" ? "Virou Oportunidade"
              : to ? `Movido para ${PIPELINE_LABEL[to] ?? to}` : (a.body ?? "Mudou de funil"),
            detail: meta.from ? `Vinha de ${PIPELINE_LABEL[meta.from] ?? meta.from}` : undefined,
          });
          break;
        }
        case "STAGE_CHANGED":
          steps.push({
            id: `act-${a.id}`, kind: "stage", timestamp: ts, actor,
            title: meta.to ? `Etapa: ${meta.to}` : (a.body ?? "Mudou de etapa"),
            detail: meta.from ? `Antes: ${meta.from}` : undefined,
          });
          break;
        case "VALUE_CHANGED":
          steps.push({ id: `act-${a.id}`, kind: "value", timestamp: ts, actor, title: a.body ?? "Valor alterado" });
          break;
        case "ASSIGNEE_CHANGED":
        case "SECTOR_CHANGED":
        case "TRANSFERRED":
          steps.push({
            id: `act-${a.id}`, kind: "assigned", timestamp: ts, actor,
            title: a.body ?? "Responsável alterado",
          });
          break;
        case "TRACKING_LINK_SET":
          steps.push({ id: `act-${a.id}`, kind: "link", timestamp: ts, actor, title: a.body ?? "Link enviado ao cliente" });
          break;
        case "STATUS_CHANGED":
        case "CONVERSATION_CLOSED":
        case "CONVERSATION_REOPENED":
          steps.push({
            id: `act-${a.id}`, kind: "status", timestamp: ts, actor,
            title: a.body ?? (a.type === "CONVERSATION_CLOSED" ? "Atendimento finalizado" : "Status alterado"),
          });
          break;
        case "NOTE_ADDED":
          // Só a nota que a triagem automática grava — as anotações manuais
          // ficam na timeline, não são marco de jornada.
          if (a.body?.startsWith("Qualificação da triagem automática")) {
            aiInvolved = true;
            steps.push({
              id: `act-${a.id}`, kind: "ai", timestamp: ts,
              title: "IA qualificou o lead",
              detail: preview(a.body.replace(/^Qualificação da triagem automática:\s*/, ""), 200),
            });
          }
          break;
      }
    }
  } catch (e) {
    console.warn("[journey] activities bucket falhou", e);
  }

  // Promoção automática (link/email/WhatsApp) — só se não houver Activity
  // equivalente, pra não duplicar o marco.
  if (lead.promotedAt && !steps.some((s) => s.kind === "pipeline")) {
    steps.push({
      id: `promoted-${lead.id}`,
      kind: "pipeline",
      timestamp: lead.promotedAt.toISOString(),
      title: `Promovido para ${PIPELINE_LABEL[lead.pipeline ?? ""] ?? lead.pipeline ?? "—"}`,
      detail: [
        lead.promotedFromPipeline ? `Vinha de ${PIPELINE_LABEL[lead.promotedFromPipeline] ?? lead.promotedFromPipeline}` : null,
        lead.promotedReason ? `Cliente ${PROMOTED_REASON[lead.promotedReason] ?? lead.promotedReason}` : null,
      ].filter(Boolean).join(" · ") || undefined,
    });
  }

  // ── 5. Link / diagnóstico abertos ──────────────────────────────────────────
  if (lead.trackingLinkId) {
    try {
      const [firstOpen, opens] = await Promise.all([
        prisma.clickEvent.findFirst({
          where: { trackingLinkId: lead.trackingLinkId, kind: "OPEN" },
          orderBy: { createdAt: "asc" },
          select: { id: true, createdAt: true },
        }),
        prisma.clickEvent.count({ where: { trackingLinkId: lead.trackingLinkId, kind: "OPEN" } }),
      ]);
      if (firstOpen) {
        steps.push({
          id: `open-${firstOpen.id}`,
          kind: "link",
          timestamp: firstOpen.createdAt.toISOString(),
          title: "Cliente abriu o link/proposta",
          detail: opens > 1 ? `${opens} aberturas no total` : undefined,
        });
      }
    } catch (e) {
      console.warn("[journey] link bucket falhou", e);
    }
  }
  if (lead.diagnosisClickedAt) {
    steps.push({
      id: `diag-${lead.id}`,
      kind: "link",
      timestamp: lead.diagnosisClickedAt.toISOString(),
      title: "Cliente abriu o diagnóstico",
    });
  }

  // ── 6. Desfecho ────────────────────────────────────────────────────────────
  const valueStr = lead.value != null
    ? `R$ ${lead.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
    : undefined;
  if (lead.wonAt) {
    steps.push({ id: `won-${lead.id}`, kind: "won", timestamp: lead.wonAt.toISOString(), title: "Venda fechada", detail: valueStr });
  }
  if (lead.lostAt) {
    steps.push({ id: `lost-${lead.id}`, kind: "lost", timestamp: lead.lostAt.toISOString(), title: "Negócio perdido" });
  }

  steps.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // ── Resumo ─────────────────────────────────────────────────────────────────
  const startedAt = firstInAt && firstInAt < first.createdAt ? firstInAt : first.createdAt;
  const endAt = lead.wonAt ?? lead.lostAt ?? new Date();
  const summary: JourneySummary = {
    origin: sourceLabel(first.source),
    startedAt: startedAt.toISOString(),
    days: Math.max(0, Math.round((endAt.getTime() - startedAt.getTime()) / 86_400_000)),
    outcome: lead.wonAt ? "won" : lead.lostAt ? "lost" : "open",
    value: lead.value,
    messagesIn,
    messagesOut,
    aiInvolved,
    attendants: [...attendants],
    firstResponseMinutes,
  };

  return NextResponse.json({ summary, steps });
}
