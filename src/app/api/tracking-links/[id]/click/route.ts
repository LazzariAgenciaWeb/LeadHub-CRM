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
    autoCreateHotTasks(link.id, link.label ?? link.destination),
  ]);

  return NextResponse.json({ ok: true });
}

/**
 * Para cada lead que tem este `trackingLinkId`, cria uma tarefa "sinal quente"
 * se não houver outra auto-tarefa em aberto criada nas últimas N horas (cooldown).
 *
 * Atribui à pessoa responsável pela conversa do lead, se houver — caso contrário
 * fica `assigneeId = null` (qualquer vendedor do setor pode pegar).
 */
async function autoCreateHotTasks(trackingLinkId: string, linkLabel: string) {
  try {
    const leads = await prisma.lead.findMany({
      where: { trackingLinkId },
      select: {
        id: true,
        name: true,
        phone: true,
        companyId: true,
        conversation: { select: { assigneeId: true } },
      },
      take: 50,
    });
    if (leads.length === 0) return;

    const cooldown = new Date(Date.now() - HOT_TASK_COOLDOWN_HOURS * 60 * 60 * 1000);
    const dueAt = new Date(Date.now() + HOT_TASK_DUE_OFFSET_MIN * 60 * 1000);

    await Promise.all(
      leads.map(async (lead) => {
        const existing = await prisma.task.findFirst({
          where: {
            leadId: lead.id,
            source: "AUTO_LINK_OPEN",
            done: false,
            createdAt: { gte: cooldown },
          },
          select: { id: true },
        });
        if (existing) return;

        await prisma.task.create({
          data: {
            title: HOT_TASK_TITLE,
            dueAt,
            leadId: lead.id,
            companyId: lead.companyId,
            assigneeId: lead.conversation?.assigneeId ?? null,
            source: "AUTO_LINK_OPEN",
            notes: `Auto-criada porque ${lead.name ?? lead.phone} abriu "${linkLabel}" agora.`,
          },
        });

        // Push notification — sinal mais quente que existe em vendas
        if (lead.conversation?.assigneeId) {
          const leadHref = `/crm/leads?lead=${lead.id}`; // CRMBoard auto-abre o drawer
          await sendPushToUser(
            lead.conversation.assigneeId,
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
