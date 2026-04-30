import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType } from "@/generated/prisma";

/**
 * GET/POST /api/cron/sla
 *
 * Job que move conversas OPEN sem resposta para PENDING quando passa o SLA.
 * Roda idealmente a cada 1-2 minutos via cron externo (Vercel Cron, Railway).
 *
 * SLA por empresa: lê de Setting.key = "sla_minutes:<companyId>" (default 15min).
 *
 * Segurança: aceita header `Authorization: Bearer <CRON_SECRET>` se a env var existir.
 * Se CRON_SECRET não estiver configurada, aceita qualquer chamada (dev mode).
 */
async function handle(req: NextRequest) {
  // Verificação opcional do secret de cron
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  // Lê todos os SLAs configurados
  const slaSettings = await prisma.setting.findMany({
    where: { key: { startsWith: "sla_minutes:" } },
  });
  const slaByCompany = new Map<string, number>();
  for (const s of slaSettings) {
    const companyId = s.key.replace("sla_minutes:", "");
    const min = parseInt(s.value, 10);
    if (!isNaN(min) && min > 0) slaByCompany.set(companyId, min);
  }

  const DEFAULT_SLA_MIN = 15;

  // Conversas OPEN candidatas a virar PENDING
  // (último update foi há > SLA do tenant)
  const candidates = await prisma.conversation.findMany({
    where: { status: "OPEN" },
    select: { id: true, companyId: true, statusUpdatedAt: true },
  });

  let promoted = 0;
  const now = Date.now();
  const promotedIds: string[] = [];

  for (const conv of candidates) {
    const slaMin = slaByCompany.get(conv.companyId) ?? DEFAULT_SLA_MIN;
    const ageMin = (now - conv.statusUpdatedAt.getTime()) / 60000;
    if (ageMin >= slaMin) {
      promotedIds.push(conv.id);
    }
  }

  if (promotedIds.length > 0) {
    await prisma.conversation.updateMany({
      where: { id: { in: promotedIds } },
      data: { status: "PENDING", statusUpdatedAt: new Date() },
    });

    // Log de Activity (em batch — pode ser pesado se promotedIds for grande, mas raro)
    const activities = await Promise.all(
      promotedIds.map((conversationId) =>
        prisma.conversation.findUnique({
          where: { id: conversationId },
          select: { companyId: true },
        }).then((c) => c
          ? prisma.activity.create({
              data: {
                type: ActivityType.STATUS_CHANGED,
                body: "Conversa marcada como SEM ATENDIMENTO (SLA estourado)",
                meta: { from: "OPEN", to: "PENDING" } as any,
                conversationId,
                companyId: c.companyId,
              },
            })
          : null
        )
      )
    );
    promoted = activities.filter(Boolean).length;
  }

  return NextResponse.json({
    ok: true,
    candidates: candidates.length,
    promoted,
    timestamp: new Date().toISOString(),
  });
}

export const GET  = handle;
export const POST = handle;
