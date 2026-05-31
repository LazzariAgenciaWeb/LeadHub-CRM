import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";

const HOT_TASK_COOLDOWN_HOURS = 6;
const HOT_TASK_DUE_OFFSET_MIN = 30;
const HOT_TASK_TITLE = "🔥 Cliente abriu o link — ligar agora";

// POST /api/tracking-links/[id]/click — público, sem auth
// Disparado pelo RedirectClient quando o cliente abre /r/CODE.
// Além de incrementar o contador, registra um ClickEvent (kind=OPEN) e dispara
// a auto-criação de tarefa quente para os leads vinculados ao link.
//
// O fetch que aciona essa rota é fire-and-forget no client (RedirectClient.tsx)
// — então não há problema em fazer trabalho extra aqui sem atrasar o cliente.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const link = await prisma.trackingLink
    .findUnique({ where: { id }, select: { id: true, destination: true, label: true } })
    .catch(() => null);
  if (!link) return NextResponse.json({ ok: true });

  await Promise.allSettled([
    prisma.trackingLink.update({
      where: { id: link.id },
      data: { clicks: { increment: 1 } },
    }),
    prisma.clickEvent.create({
      data: {
        trackingLinkId: link.id,
        targetUrl: link.destination,
        targetLabel: link.label ?? null,
        kind: "OPEN",
      },
    }),
    onLinkClicked(link.id, link.label ?? link.destination),
  ]);

  return NextResponse.json({ ok: true });
}

/**
 * Reação central a um clique de link rastreado, pra cada lead vinculado:
 *  1. Promove prospect → lead se ele estava em PROSPECCAO (demonstrou interesse).
 *  2. Cria tarefa "sinal quente" (cooldown) + push pro responsável.
 *
 * Roda em fire-and-forget — nunca quebra o redirect do cliente.
 */
async function onLinkClicked(trackingLinkId: string, linkLabel: string) {
  try {
    const leads = await prisma.lead.findMany({
      where: { trackingLinkId },
      select: {
        id: true,
        name: true,
        phone: true,
        companyId: true,
        pipeline: true,
        pipelineStage: true,
        conversation: { select: { assigneeId: true } },
      },
      take: 50,
    });
    if (leads.length === 0) return;

    // Cache da 1ª etapa do pipeline LEADS por empresa (evita N queries iguais)
    const firstLeadStageCache = new Map<string, string | null>();
    async function firstLeadStage(companyId: string): Promise<string | null> {
      if (firstLeadStageCache.has(companyId)) return firstLeadStageCache.get(companyId)!;
      const stage = await prisma.pipelineStageConfig.findFirst({
        where: { companyId, pipeline: "LEADS" },
        orderBy: { order: "asc" },
        select: { name: true },
      });
      const name = stage?.name ?? "Novo Lead";
      firstLeadStageCache.set(companyId, name);
      return name;
    }

    const cooldown = new Date(Date.now() - HOT_TASK_COOLDOWN_HOURS * 60 * 60 * 1000);
    const dueAt = new Date(Date.now() + HOT_TASK_DUE_OFFSET_MIN * 60 * 1000);

    await Promise.all(
      leads.map(async (lead) => {
        const assigneeId = lead.conversation?.assigneeId ?? null;
        const leadHref = `/crm/leads?lead=${lead.id}`;

        // ── 1) Promoção Prospect → Lead (demonstrou interesse) ──
        if (lead.pipeline === "PROSPECCAO") {
          const targetStage = await firstLeadStage(lead.companyId);
          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              pipeline: "LEADS",
              pipelineStage: targetStage,
              // Atribuição: clique foi via shortlink (sem campanha de email associada).
              promotedFromPipeline: "PROSPECCAO",
              promotedAt: new Date(),
              promotedReason: "link_click",
            },
          });
          await prisma.activity.create({
            data: {
              type: "PIPELINE_CHANGED",
              leadId: lead.id,
              companyId: lead.companyId,
              authorName: "Sistema",
              body: `Prospect demonstrou interesse (abriu "${linkLabel}") → movido para Leads`,
              meta: { from: "PROSPECCAO", to: "LEADS", reason: "link_click", linkLabel },
            },
          }).catch(() => null);

          if (assigneeId) {
            await sendPushToUser(
              assigneeId,
              {
                title: "🎯 Prospect demonstrou interesse!",
                body: `${lead.name ?? lead.phone} abriu "${linkLabel}" e virou Lead. Atenda agora.`,
                url: leadHref,
                tag: `promote-${lead.id}`,
              },
              "hotSignal"
            );
          }
        }

        // ── 2) Tarefa de sinal quente (com cooldown) ──
        const existing = await prisma.task.findFirst({
          where: { leadId: lead.id, source: "AUTO_LINK_OPEN", done: false, createdAt: { gte: cooldown } },
          select: { id: true },
        });
        if (existing) return;

        await prisma.task.create({
          data: {
            title: HOT_TASK_TITLE,
            dueAt,
            leadId: lead.id,
            companyId: lead.companyId,
            assigneeId,
            source: "AUTO_LINK_OPEN",
            notes: `Auto-criada porque ${lead.name ?? lead.phone} abriu "${linkLabel}" agora.`,
          },
        });

        if (assigneeId) {
          await sendPushToUser(
            assigneeId,
            {
              title: "🔥 Cliente abriu sua proposta!",
              body: `${lead.name ?? lead.phone} acabou de abrir "${linkLabel}". Liga agora.`,
              url: leadHref,
              tag: `hot-${lead.id}`,
            },
            "hotSignal"
          );
        }
      })
    );
  } catch {
    // Nunca quebra o redirect por causa disso.
  }
}
